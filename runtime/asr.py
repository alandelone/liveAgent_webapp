from __future__ import annotations

import array
import os
import threading
from typing import Protocol


class StreamingAsrAdapter(Protocol):
    def warm(self) -> None: ...
    def start_turn(self) -> None: ...
    def accept_pcm(self, pcm_s16le: bytes) -> str | None: ...
    def finish(self) -> str: ...
    def health(self) -> dict: ...


class FakeStreamingAsrAdapter:
    def __init__(self, partials: list[str], final: str | None = None):
        self.partials = partials
        self.final_text = final if final is not None else (partials[-1] if partials else "")
        self.position = 0

    def start_turn(self) -> None:
        self.position = 0

    def warm(self) -> None:
        return None

    def accept_pcm(self, pcm_s16le: bytes) -> str | None:
        del pcm_s16le
        if self.position >= len(self.partials):
            return None
        value = self.partials[self.position]
        self.position += 1
        return value

    def finish(self) -> str:
        return self.final_text

    def health(self) -> dict:
        return {"status": "ready", "backend": "fake"}


class QwenStreamingAsrAdapter:
    MODEL_REVISION = os.environ.get(
        "QWEN_ASR_MODEL_REVISION", "7278e1e70fe206f11671096ffdd38061171dd6e5"
    )
    _shared_model = None
    _model_lock = threading.Lock()
    _inference_lock = threading.Lock()

    def __init__(self, model_name: str | None = None):
        self.model_name = model_name or os.environ.get("QWEN_ASR_MODEL", "Qwen/Qwen3-ASR-1.7B")
        self.model = None
        self.state = None
        self.pending = array.array("h")

    def _ensure_model(self):
        if self.model is not None:
            return
        with self._model_lock:
            if self.__class__._shared_model is None:
                from qwen_asr import Qwen3ASRModel

                self.__class__._shared_model = Qwen3ASRModel.LLM(
                    model=self.model_name,
                    revision=self.MODEL_REVISION,
                    gpu_memory_utilization=float(os.environ.get("QWEN_ASR_GPU_MEMORY_UTILIZATION", "0.88")),
                    max_new_tokens=64,
                    max_model_len=4_096,
                    max_num_seqs=1,
                    max_num_batched_tokens=1_024,
                    kv_cache_memory_bytes=536_870_912,
                    limit_mm_per_prompt={"audio": 1},
                    enforce_eager=True,
                )
            self.model = self.__class__._shared_model

    def warm(self) -> None:
        self._ensure_model()

    def start_turn(self) -> None:
        self._ensure_model()
        self.pending = array.array("h")
        with self._inference_lock:
            self.state = self.model.init_streaming_state(
                unfixed_chunk_num=2,
                unfixed_token_num=5,
                chunk_size_sec=1.0,
            )

    def accept_pcm(self, pcm_s16le: bytes) -> str | None:
        import numpy as np

        if self.state is None:
            raise RuntimeError("ASR turn is not active")
        samples = array.array("h")
        samples.frombytes(pcm_s16le)
        self.pending.extend(samples)
        changed = False
        while len(self.pending) >= 16_000:
            chunk = np.asarray(self.pending[:16_000], dtype=np.float32) / 32768.0
            del self.pending[:16_000]
            with self._inference_lock:
                self.model.streaming_transcribe(chunk, self.state)
            changed = True
        return self.state.text.strip() if changed else None

    def finish(self) -> str:
        import numpy as np

        if self.state is None:
            return ""
        if self.pending:
            chunk = np.asarray(self.pending, dtype=np.float32) / 32768.0
            with self._inference_lock:
                self.model.streaming_transcribe(chunk, self.state)
        with self._inference_lock:
            self.model.finish_streaming_transcribe(self.state)
        text = self.state.text.strip()
        self.state = None
        self.pending = array.array("h")
        return text

    def health(self) -> dict:
        return {
            "status": "ready" if self.model is not None else "cold",
            "backend": "qwen-vllm",
            "model": self.model_name,
            "revision": self.MODEL_REVISION,
        }


def create_asr_adapter() -> StreamingAsrAdapter:
    backend = os.environ.get("RUNTIME_ASR_BACKEND", "fake").lower()
    if backend == "qwen":
        return QwenStreamingAsrAdapter()
    if backend == "fake":
        return FakeStreamingAsrAdapter(["test partial"], "test final")
    raise ValueError(f"unsupported RUNTIME_ASR_BACKEND: {backend}")
