from __future__ import annotations

import asyncio
from array import array
from dataclasses import dataclass
import json
import ipaddress
import math
import struct
from typing import Protocol
from urllib import error, request
from urllib.parse import urlparse


TTS_SAMPLE_RATE_HZ = 24_000
TTS_CHUNK_FRAMES = 2_400
TTS_MAX_CLAUSE_CHARS = 220
TTS_MAX_AUDIO_SECONDS = 30


class TtsError(RuntimeError):
    pass


class TtsUnavailable(TtsError):
    pass


@dataclass(frozen=True, slots=True)
class TtsRequest:
    turn_id: str
    stream_id: str
    text: str
    language: str
    speaker: str
    deadline_ms: int = 15_000

    def validate(self) -> None:
        if not self.turn_id or not self.stream_id:
            raise ValueError("turn_id and stream_id are required")
        if not self.text or len(self.text) > TTS_MAX_CLAUSE_CHARS:
            raise ValueError("TTS clause is empty or exceeds the character limit")
        if self.language not in {"Chinese", "English"}:
            raise ValueError("unsupported TTS language")
        expected_speaker = "Vivian" if self.language == "Chinese" else "Ryan"
        if self.speaker != expected_speaker:
            raise ValueError("speaker does not match the fixed language profile")
        if not 100 <= self.deadline_ms <= 15_000:
            raise ValueError("TTS deadline is outside the supported range")


@dataclass(frozen=True, slots=True)
class TtsAudio:
    sample_rate_hz: int
    samples: tuple[float, ...]

    def validate(self) -> None:
        if self.sample_rate_hz != TTS_SAMPLE_RATE_HZ:
            raise TtsError(f"expected {TTS_SAMPLE_RATE_HZ} Hz audio")
        if not self.samples:
            raise TtsError("TTS returned empty audio")
        if len(self.samples) > self.sample_rate_hz * TTS_MAX_AUDIO_SECONDS:
            raise TtsError("TTS audio exceeds the duration limit")
        if any(not math.isfinite(value) or value < -1.0 or value > 1.0 for value in self.samples):
            raise TtsError("TTS audio contains invalid samples")

    @property
    def duration_ms(self) -> float:
        return len(self.samples) * 1000 / self.sample_rate_hz

    def chunks(self, chunk_frames: int = TTS_CHUNK_FRAMES) -> tuple[bytes, ...]:
        self.validate()
        if not 1 <= chunk_frames <= TTS_CHUNK_FRAMES:
            raise ValueError("invalid TTS chunk size")
        result = []
        for offset in range(0, len(self.samples), chunk_frames):
            values = array("f", self.samples[offset : offset + chunk_frames])
            if values.itemsize != 4:
                raise RuntimeError("float32 transport is unavailable")
            if struct.pack("=I", 1)[0] != 1:
                values.byteswap()
            result.append(values.tobytes())
        return tuple(result)


class TtsAdapter(Protocol):
    model_revision: str

    async def synthesize(self, item: TtsRequest) -> TtsAudio: ...


class DisabledTtsAdapter:
    model_revision = "disabled"

    async def synthesize(self, item: TtsRequest) -> TtsAudio:
        raise TtsUnavailable("TTS is disabled by the active deployment profile")


class DeterministicTtsAdapter:
    model_revision = "deterministic-fixture-v1"

    def __init__(self, *, duration_ms: int = 240, frequency_hz: int = 440) -> None:
        if not 20 <= duration_ms <= 2_000:
            raise ValueError("deterministic duration is outside test bounds")
        self.duration_ms = duration_ms
        self.frequency_hz = frequency_hz

    async def synthesize(self, item: TtsRequest) -> TtsAudio:
        item.validate()
        frame_count = self.duration_ms * TTS_SAMPLE_RATE_HZ // 1000
        samples = tuple(
            0.12 * math.sin(2 * math.pi * self.frequency_hz * index / TTS_SAMPLE_RATE_HZ)
            for index in range(frame_count)
        )
        return TtsAudio(TTS_SAMPLE_RATE_HZ, samples)


class LoopbackTtsAdapter:
    model_revision = ""
    service_name = "TTS"

    def __init__(self, endpoint: str, *, timeout_s: float = 15.0, allow_private: bool = False) -> None:
        parsed = urlparse(endpoint)
        try:
            address = ipaddress.ip_address(parsed.hostname or "")
        except ValueError as exc:
            raise ValueError(f"{self.service_name} endpoint must use an explicit local IPv4 address") from exc
        if parsed.scheme != "http" or address.version != 4 or parsed.path not in {"", "/"} or parsed.query or parsed.fragment:
            raise ValueError(f"{self.service_name} endpoint is invalid")
        if not address.is_loopback and not (allow_private and address.is_private):
            raise ValueError(f"{self.service_name} endpoint must be IPv4 loopback or an approved private host interface")
        self.endpoint = endpoint.rstrip("/")
        self.timeout_s = timeout_s

    async def healthcheck(self) -> dict[str, object]:
        payload, _headers = await asyncio.to_thread(self._request, "/health", None)
        metadata = json.loads(payload.decode("utf-8"))
        if metadata.get("status") != "ok" or metadata.get("revision") != self.model_revision:
            raise TtsUnavailable(f"{self.service_name} service provenance check failed")
        return metadata

    async def synthesize(self, item: TtsRequest) -> TtsAudio:
        item.validate()
        body = json.dumps(
            {"text": item.text, "language": item.language, "speaker": item.speaker},
            ensure_ascii=False,
        ).encode("utf-8")
        raw, headers = await asyncio.wait_for(
            asyncio.to_thread(self._request, "/synthesize", body),
            timeout=item.deadline_ms / 1000,
        )
        if headers.get("x-audio-encoding") != "pcm_f32le" or headers.get("x-sample-rate-hz") != str(TTS_SAMPLE_RATE_HZ):
            raise TtsError(f"{self.service_name} returned an unsupported audio format")
        if len(raw) % 4:
            raise TtsError(f"{self.service_name} returned misaligned float32 PCM")
        values = array("f")
        values.frombytes(raw)
        if struct.pack("=I", 1)[0] != 1:
            values.byteswap()
        audio = TtsAudio(TTS_SAMPLE_RATE_HZ, tuple(values))
        audio.validate()
        return audio

    def _request(self, path: str, body: bytes | None) -> tuple[bytes, dict[str, str]]:
        headers = {"Accept": "application/octet-stream, application/json"}
        if body is not None:
            headers["Content-Type"] = "application/json; charset=utf-8"
        call = request.Request(self.endpoint + path, data=body, headers=headers, method="POST" if body is not None else "GET")
        try:
            with request.urlopen(call, timeout=self.timeout_s) as response:
                if response.status != 200:
                    raise TtsUnavailable(f"{self.service_name} service returned HTTP {response.status}")
                payload = response.read(TTS_SAMPLE_RATE_HZ * TTS_MAX_AUDIO_SECONDS * 4 + 1)
                return payload, {key.lower(): value for key, value in response.headers.items()}
        except (error.URLError, TimeoutError) as exc:
            raise TtsUnavailable(f"{self.service_name} service is unavailable") from exc


class LoopbackQwenTtsAdapter(LoopbackTtsAdapter):
    model_revision = "85e237c12c027371202489a0ec509ded67b5e4b5"
    service_name = "Qwen TTS"

    def __init__(self, endpoint: str = "http://127.0.0.1:8770", *, timeout_s: float = 15.0) -> None:
        super().__init__(endpoint, timeout_s=timeout_s)


class LoopbackKokoroTtsAdapter(LoopbackTtsAdapter):
    model_revision = "01e7505bd6a7a2ac4975463114c3a7650a9f7218"
    service_name = "Kokoro TTS"

    def __init__(self, endpoint: str = "http://127.0.0.1:8771", *, timeout_s: float = 15.0) -> None:
        super().__init__(endpoint, timeout_s=timeout_s, allow_private=True)
