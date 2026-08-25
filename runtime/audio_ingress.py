from __future__ import annotations

import asyncio
from dataclasses import dataclass
from enum import Enum


PCM_FRAME_BYTES = 640
SERVER_QUEUE_FRAMES = 200


class InvalidAudioFrame(ValueError):
    pass


class AudioBackpressure(RuntimeError):
    pass


class CaptureState(str, Enum):
    IDLE = "IDLE"
    CAPTURING = "CAPTURING"


@dataclass(frozen=True)
class CaptureFormat:
    encoding: str = "pcm_s16le"
    sample_rate_hz: int = 16_000
    channels: int = 1
    frame_ms: int = 20

    @classmethod
    def from_payload(cls, payload: dict) -> "CaptureFormat":
        return cls(
            encoding=payload.get("encoding", ""),
            sample_rate_hz=payload.get("sampleRateHz", 0),
            channels=payload.get("channels", 0),
            frame_ms=payload.get("frameMs", 0),
        )

    def validate(self) -> None:
        if self != CaptureFormat():
            raise InvalidAudioFrame("capture format must be pcm_s16le/16000Hz/mono/20ms")


class SessionAudioIngress:
    def __init__(self, max_frames: int = SERVER_QUEUE_FRAMES):
        self.queue: asyncio.Queue[bytes | None] = asyncio.Queue(maxsize=max_frames)
        self.state = CaptureState.IDLE
        self.capture_id: str | None = None
        self.accepted_frames = 0

    def start(self, capture_id: str, format_payload: dict) -> None:
        if self.state is CaptureState.CAPTURING or not capture_id:
            raise InvalidAudioFrame("capture is already active or captureId is empty")
        CaptureFormat.from_payload(format_payload).validate()
        self._clear_queue()
        self.state = CaptureState.CAPTURING
        self.capture_id = capture_id
        self.accepted_frames = 0

    def accept(self, frame: bytes) -> None:
        if self.state is not CaptureState.CAPTURING:
            raise InvalidAudioFrame("binary audio received outside an active capture")
        if len(frame) != PCM_FRAME_BYTES:
            raise InvalidAudioFrame(f"PCM frame must be {PCM_FRAME_BYTES} bytes")
        try:
            self.queue.put_nowait(bytes(frame))
            self.accepted_frames += 1
        except asyncio.QueueFull as exc:
            self.state = CaptureState.IDLE
            self.capture_id = None
            self._clear_queue()
            raise AudioBackpressure("session audio queue exceeded 200 frames") from exc

    async def end(self, capture_id: str) -> None:
        if self.state is not CaptureState.CAPTURING or capture_id != self.capture_id:
            raise InvalidAudioFrame("CAPTURE_END does not match the active capture")
        self.state = CaptureState.IDLE
        self.capture_id = None
        await self.queue.put(None)

    def reset(self) -> None:
        self.state = CaptureState.IDLE
        self.capture_id = None
        self.accepted_frames = 0
        self._clear_queue()

    def _clear_queue(self) -> None:
        while True:
            try:
                self.queue.get_nowait()
            except asyncio.QueueEmpty:
                break
