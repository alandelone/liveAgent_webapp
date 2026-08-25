from __future__ import annotations

import io
import json
from pathlib import Path
import subprocess
import sys
import time
import urllib.request

import numpy as np
import soundfile as sf

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from runtime.asr import QwenStreamingAsrAdapter
from runtime.vad import SileroProbabilityAdapter


AUDIO_URL = "https://qianwen-res.oss-cn-beijing.aliyuncs.com/Qwen3-ASR-Repo/asr_en.wav"


def board_memory_mib() -> int:
    value = subprocess.check_output(
        ["nvidia-smi", "--query-gpu=memory.used", "--format=csv,noheader,nounits"],
        text=True,
    )
    return int(value.strip().splitlines()[0])


def load_pcm() -> bytes:
    request = urllib.request.Request(AUDIO_URL, headers={"User-Agent": "livechat-agent/0.2"})
    with urllib.request.urlopen(request, timeout=60) as response:
        waveform, sample_rate = sf.read(io.BytesIO(response.read()), dtype="float32", always_2d=False)
    waveform = np.asarray(waveform, dtype=np.float32)
    if waveform.ndim > 1:
        waveform = waveform.mean(axis=1)
    if sample_rate != 16_000:
        duration = waveform.shape[0] / sample_rate
        old_axis = np.linspace(0, duration, waveform.shape[0], endpoint=False)
        new_axis = np.linspace(0, duration, round(duration * 16_000), endpoint=False)
        waveform = np.interp(new_axis, old_axis, waveform).astype(np.float32)
    return (np.clip(waveform, -1, 1) * 32767).astype("<i2").tobytes()


def main() -> int:
    pcm = load_pcm()
    vad = SileroProbabilityAdapter()
    probabilities = [vad.probability(pcm[offset : offset + 640]) for offset in range(0, len(pcm) - 639, 640)]
    if not probabilities or max(probabilities) < 0.5:
        raise RuntimeError("Silero did not detect speech in the official Qwen sample")

    idle = board_memory_mib()
    adapter = QwenStreamingAsrAdapter()
    started = time.perf_counter()
    adapter.start_turn()
    loaded = board_memory_mib()
    partials = []
    for offset in range(0, len(pcm), 640):
        partial = adapter.accept_pcm(pcm[offset : offset + 640])
        if partial:
            partials.append(partial)
    final = adapter.finish()
    latency_ms = (time.perf_counter() - started) * 1000
    if not final:
        raise RuntimeError("Qwen adapter produced an empty final transcript")
    print(
        json.dumps(
            {
                "status": "pass",
                "modelRevision": adapter.MODEL_REVISION,
                "sileroMaxProbability": round(max(probabilities), 6),
                "sileroWindows": len(probabilities),
                "partialCount": len(partials),
                "finalTranscript": final,
                "adapterLatencyMs": round(latency_ms, 3),
                "idleBoardMemoryMiB": idle,
                "loadedBoardMemoryMiB": loaded,
                "recoveryMemoryMiB": 12_282 - loaded,
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
