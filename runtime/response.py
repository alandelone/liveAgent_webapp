from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
import re
from uuid import uuid4

from runtime.tts import DisabledTtsAdapter, TTS_CHUNK_FRAMES, TtsAdapter, TtsError, TtsRequest, TtsUnavailable


EventCallback = Callable[[dict], Awaitable[None]]
BinaryCallback = Callable[[bytes], Awaitable[None]]


def segment_clauses(text: str, maximum: int = 220) -> tuple[str, ...]:
    normalized = " ".join(text.split())
    if not normalized:
        return ()
    protected = re.sub(r"`[^`]*`|https?://\S+", lambda match: match.group(0).replace(".", "\u2024"), normalized)
    pieces = re.split(r"(?<=[。！？!?；;])\s*|(?<=[,.，、:：])\s+(?=\S)", protected)
    clauses: list[str] = []
    for piece in pieces:
        restored = piece.replace("\u2024", ".").strip()
        while len(restored) > maximum:
            boundary = restored.rfind(" ", 0, maximum + 1)
            if boundary < maximum // 2:
                boundary = maximum
            clauses.append(restored[:boundary].strip())
            restored = restored[boundary:].strip()
        if restored:
            clauses.append(restored)
    return tuple(clauses)


def choose_language(text: str) -> tuple[str, str]:
    chinese = sum("\u4e00" <= character <= "\u9fff" for character in text)
    latin = sum(character.isascii() and character.isalpha() for character in text)
    return ("Chinese", "Vivian") if chinese >= max(1, latin) else ("English", "Ryan")


@dataclass(slots=True)
class ActiveResponse:
    turn_id: str
    revision: int
    cancellation: asyncio.Event
    stream_id: str | None = None


class ResponseCoordinator:
    def __init__(self, emit_event: EventCallback, emit_binary: BinaryCallback | None = None, *, tts: TtsAdapter | None = None, agent_id: str = "local-supervisor", chunk_yield_delay_s: float = 0.0) -> None:
        self.emit_event = emit_event
        self.emit_binary = emit_binary
        self.tts = tts or DisabledTtsAdapter()
        self.agent_id = agent_id
        self.chunk_yield_delay_s = max(0.0, chunk_yield_delay_s)
        self.revision = 0
        self.active: ActiveResponse | None = None
        self.last_response = ""

    @property
    def is_active(self) -> bool:
        return self.active is not None

    async def deliver(self, turn_id: str, text: str) -> None:
        self.revision += 1
        revision = self.revision
        active = ActiveResponse(turn_id, revision, asyncio.Event())
        previous = self.active
        if previous:
            previous.cancellation.set()
        self.active = active
        self.last_response = text
        await self.emit_event({"type": "TEXT_DELTA", "agentId": self.agent_id, "turnId": turn_id, "delta": text, "isFinal": True})

        if self.emit_binary is None or isinstance(self.tts, DisabledTtsAdapter):
            if self.active is active:
                self.active = None
                await self.emit_event({"type": "AGENT_STATE", "agentId": self.agent_id, "state": "idle", "detail": "Voice output unavailable; response delivered as text"})
            return

        clauses = segment_clauses(text)
        if not clauses:
            self.active = None
            await self.emit_event({"type": "AGENT_STATE", "agentId": self.agent_id, "state": "idle"})
            return

        stream_id = f"tts-{revision}-{uuid4().hex[:8]}"
        active.stream_id = stream_id
        await self.emit_event({"type": "AGENT_STATE", "agentId": self.agent_id, "state": "speaking"})
        await self.emit_event({
            "type": "TTS_START", "agentId": self.agent_id, "turnId": turn_id, "streamId": stream_id,
            "format": {"encoding": "pcm_f32le", "sampleRateHz": 24_000, "channels": 1, "chunkFrames": TTS_CHUNK_FRAMES},
        })
        prefetched: asyncio.Task | None = None
        try:
            async def synthesize_clause(clause: str):
                language, speaker = choose_language(clause)
                item = TtsRequest(turn_id, stream_id, clause, language, speaker)
                result = await asyncio.wait_for(self.tts.synthesize(item), timeout=item.deadline_ms / 1000)
                result.validate()
                return result

            audio = await synthesize_clause(clauses[0])
            for index, clause in enumerate(clauses):
                if not self._current(active):
                    break
                if index + 1 < len(clauses):
                    prefetched = asyncio.create_task(synthesize_clause(clauses[index + 1]))
                audio.validate()
                if not self._current(active):
                    break
                for chunk in audio.chunks():
                    if not self._current(active):
                        break
                    await self.emit_binary(chunk)
                    await asyncio.sleep(self.chunk_yield_delay_s)
                if prefetched is not None:
                    audio = await prefetched
                    prefetched = None
            if self._current(active):
                await self.emit_event({"type": "TTS_END", "agentId": self.agent_id, "turnId": turn_id, "streamId": stream_id, "outcome": "COMPLETED"})
                active.stream_id = None
        except (asyncio.TimeoutError, TtsError, ValueError) as exc:
            if self._current(active):
                await self.emit_event({"type": "TTS_END", "agentId": self.agent_id, "turnId": turn_id, "streamId": stream_id, "outcome": "FAILED", "reasonCode": type(exc).__name__.upper()})
                active.stream_id = None
                await self.emit_event({"type": "ERROR", "agentId": self.agent_id, "code": "TTS_UNAVAILABLE" if isinstance(exc, TtsUnavailable) else "TTS_FAILED", "message": "Voice output failed; the complete response remains available as text.", "recoverable": True})
        finally:
            if prefetched is not None and not prefetched.done():
                prefetched.cancel()

        if self.active is active:
            self.active = None
            await self.emit_event({"type": "AGENT_STATE", "agentId": self.agent_id, "state": "idle"})

    async def interrupt(self) -> bool:
        self.revision += 1
        active = self.active
        if active is None:
            return False
        active.cancellation.set()
        self.active = None
        if active.stream_id:
            await self.emit_event({"type": "TTS_END", "agentId": self.agent_id, "turnId": active.turn_id, "streamId": active.stream_id, "outcome": "INTERRUPTED", "reasonCode": "RESPONSE_SCOPE_ONLY"})
        await self.emit_event({"type": "AGENT_STATE", "agentId": self.agent_id, "state": "interrupted"})
        return True

    def abandon(self) -> None:
        """Suppress connection-scoped output without cancelling logical task work."""
        self.revision += 1
        if self.active is not None:
            self.active.cancellation.set()
            self.active = None

    def _current(self, item: ActiveResponse) -> bool:
        return self.active is item and self.revision == item.revision and not item.cancellation.is_set()
