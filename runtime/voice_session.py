from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
import itertools

from .asr import StreamingAsrAdapter
from .audio_ingress import AudioBackpressure, InvalidAudioFrame, SessionAudioIngress
from .transcript import TranscriptStabilizer
from .vad import StreamingVad


EventCallback = Callable[[dict], Awaitable[None]]


class VoiceSession:
    _turn_counter = itertools.count(1)

    def __init__(
        self,
        session_id: str,
        vad: StreamingVad,
        asr: StreamingAsrAdapter,
        emit: EventCallback,
        ingress: SessionAudioIngress | None = None,
        turn_id_factory: Callable[[], str] | None = None,
    ):
        self.session_id = session_id
        self.vad = vad
        self.asr = asr
        self.emit = emit
        self.ingress = ingress or SessionAudioIngress()
        self.turn_id_factory = turn_id_factory or (lambda: f"turn_voice_{next(self._turn_counter)}")
        self.consumer: asyncio.Task | None = None
        self.turn_id: str | None = None
        self.stabilizer: TranscriptStabilizer | None = None

    async def start_capture(self, capture_id: str, format_payload: dict) -> None:
        self.ingress.start(capture_id, format_payload)
        self.vad.reset()
        self.turn_id = None
        self.stabilizer = None
        if self.consumer and not self.consumer.done():
            self.consumer.cancel()
        self.consumer = asyncio.create_task(self._consume())

    def accept_audio(self, frame: bytes) -> None:
        self.ingress.accept(frame)

    async def end_capture(self, capture_id: str) -> None:
        await self.ingress.end(capture_id)
        if self.consumer:
            await self.consumer

    async def close(self) -> None:
        if self.consumer and not self.consumer.done():
            self.consumer.cancel()
            try:
                await self.consumer
            except asyncio.CancelledError:
                pass
        self.ingress.reset()

    async def _consume(self) -> None:
        try:
            while True:
                frame = await self.ingress.queue.get()
                if frame is None:
                    for action in self.vad.force_end():
                        await self._handle_action(action.kind, action.frames)
                    return
                for action in self.vad.accept(frame):
                    await self._handle_action(action.kind, action.frames)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            await self.emit(
                {
                    "type": "ERROR",
                    "code": self._error_code(exc),
                    "message": str(exc),
                    "recoverable": True,
                }
            )
            self.ingress.reset()

    async def _handle_action(self, kind: str, frames: tuple[bytes, ...]) -> None:
        if kind == "speech_start":
            self.turn_id = self.turn_id_factory()
            self.stabilizer = TranscriptStabilizer()
            # Barge-in is latency-critical. Emit the authoritative boundary and
            # stop active TTS before any potentially cold ASR initialization.
            await self.emit({"type": "USER_SPEECH_START", "turnId": self.turn_id})
            await asyncio.to_thread(self.asr.start_turn)
            return
        if kind == "speech_audio" and self.turn_id and self.stabilizer:
            hypothesis = await asyncio.to_thread(self.asr.accept_pcm, b"".join(frames))
            if hypothesis:
                stable = self.stabilizer.update(hypothesis)
                await self.emit(
                    {
                        "type": "STT_PARTIAL",
                        "turnId": self.turn_id,
                        "text": stable.text,
                    }
                )
            return
        if kind == "speech_end" and self.turn_id and self.stabilizer:
            await self.emit({"type": "USER_SPEECH_END", "turnId": self.turn_id})
            final_text = await asyncio.to_thread(self.asr.finish)
            final = self.stabilizer.finalize(final_text)
            await self.emit({"type": "STT_FINAL", "turnId": self.turn_id, "text": final.text})
            self.turn_id = None
            self.stabilizer = None

    @staticmethod
    def _error_code(exc: Exception) -> str:
        if isinstance(exc, AudioBackpressure):
            return "AUDIO_BACKPRESSURE"
        if isinstance(exc, InvalidAudioFrame):
            return "INVALID_AUDIO_FRAME"
        message = str(exc).lower()
        if "out of memory" in message:
            return "ASR_OOM"
        if "timeout" in message:
            return "ASR_TIMEOUT"
        return "ASR_UNAVAILABLE"
