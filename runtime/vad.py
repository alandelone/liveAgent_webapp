from __future__ import annotations

from collections import deque
from dataclasses import dataclass
from typing import Protocol

import array


class ProbabilityAdapter(Protocol):
    def reset(self) -> None: ...
    def probability(self, pcm_s16le: bytes) -> float: ...


class SequenceProbabilityAdapter:
    def __init__(self, values: list[float]):
        self.values = values
        self.position = 0

    def reset(self) -> None:
        self.position = 0

    def probability(self, pcm_s16le: bytes) -> float:
        del pcm_s16le
        if self.position >= len(self.values):
            return 0.0
        value = self.values[self.position]
        self.position += 1
        return value


class EnergyProbabilityAdapter:
    def reset(self) -> None:
        return None

    def probability(self, pcm_s16le: bytes) -> float:
        samples = array.array("h")
        samples.frombytes(pcm_s16le)
        if not samples:
            return 0.0
        mean_square = sum((sample / 32768.0) ** 2 for sample in samples) / len(samples)
        return min(1.0, mean_square**0.5 * 8.0)


class SileroProbabilityAdapter:
    def __init__(self):
        from silero_vad import load_silero_vad

        self.model = load_silero_vad()
        self.pending = array.array("h")
        self.last_probability = 0.0

    def reset(self) -> None:
        self.pending = array.array("h")
        self.last_probability = 0.0
        self.model.reset_states()

    def probability(self, pcm_s16le: bytes) -> float:
        import torch

        samples = array.array("h")
        samples.frombytes(pcm_s16le)
        self.pending.extend(samples)
        while len(self.pending) >= 512:
            window = self.pending[:512]
            del self.pending[:512]
            tensor = torch.tensor(window, dtype=torch.float32) / 32768.0
            self.last_probability = float(self.model(tensor, 16_000).item())
        return self.last_probability


@dataclass(frozen=True)
class VadAction:
    kind: str
    frame_index: int
    frames: tuple[bytes, ...] = ()


class StreamingVad:
    def __init__(
        self,
        adapter: ProbabilityAdapter,
        threshold: float = 0.5,
        pre_roll_frames: int = 13,
        onset_frames: int = 5,
        endpoint_frames: int = 25,
        max_utterance_frames: int = 1500,
    ):
        self.adapter = adapter
        self.threshold = threshold
        self.pre_roll_frames = pre_roll_frames
        self.onset_frames = onset_frames
        self.endpoint_frames = endpoint_frames
        self.max_utterance_frames = max_utterance_frames
        self.reset()

    def reset(self) -> None:
        self.adapter.reset()
        self.pre_roll: deque[bytes] = deque(maxlen=self.pre_roll_frames)
        self.frame_index = -1
        self.onset_count = 0
        self.silence_count = 0
        self.speech_frames = 0
        self.active = False

    def accept(self, frame: bytes) -> list[VadAction]:
        self.frame_index += 1
        probability = self.adapter.probability(frame)
        actions: list[VadAction] = []
        if not self.active:
            self.pre_roll.append(frame)
            self.onset_count = self.onset_count + 1 if probability >= self.threshold else 0
            if self.onset_count >= self.onset_frames:
                self.active = True
                buffered = tuple(self.pre_roll)
                self.speech_frames = len(buffered)
                onset_index = self.frame_index - self.onset_frames + 1
                actions.append(VadAction("speech_start", onset_index))
                actions.append(VadAction("speech_audio", self.frame_index, buffered))
                self.pre_roll.clear()
            return actions

        self.speech_frames += 1
        actions.append(VadAction("speech_audio", self.frame_index, (frame,)))
        self.silence_count = self.silence_count + 1 if probability < self.threshold else 0
        if self.silence_count >= self.endpoint_frames or self.speech_frames >= self.max_utterance_frames:
            actions.append(VadAction("speech_end", self.frame_index))
            self.active = False
            self.onset_count = 0
            self.silence_count = 0
            self.speech_frames = 0
        return actions

    def force_end(self) -> list[VadAction]:
        if not self.active:
            return []
        self.active = False
        return [VadAction("speech_end", self.frame_index)]
