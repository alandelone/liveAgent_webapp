from __future__ import annotations

import argparse
import asyncio
from array import array
import json
import math
from pathlib import Path
import statistics
import subprocess
import sys
import time
import wave

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from runtime.tts import LoopbackKokoroTtsAdapter, LoopbackQwenTtsAdapter, TtsRequest


CASES = (
    ("zh", "你好，这是本地语音系统的中文测试。", "Chinese", "Vivian"),
    ("en", "Hello, this is the local voice system speaking.", "English", "Ryan"),
    ("mixed", "你好，the local voice pipeline is ready，可以开始测试。", "Chinese", "Vivian"),
)


def gpu_snapshot() -> dict[str, object]:
    board = subprocess.check_output(
        ["nvidia-smi", "--query-gpu=memory.used,memory.free,temperature.gpu", "--format=csv,noheader,nounits"],
        text=True,
    ).strip().split(", ")
    processes = subprocess.check_output(
        ["nvidia-smi", "--query-compute-apps=pid,used_memory", "--format=csv,noheader,nounits"],
        text=True,
    ).strip().splitlines()
    return {
        "boardUsedMiB": int(board[0]),
        "boardFreeMiB": int(board[1]),
        "temperatureC": int(board[2]),
        "computeProcesses": processes,
    }


def write_pcm16(path: Path, samples: tuple[float, ...], sample_rate: int) -> None:
    pcm = array("h", (round(max(-1, min(1, sample)) * 32767) for sample in samples))
    with wave.open(str(path), "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(sample_rate)
        output.writeframes(pcm.tobytes())


def percentile(values: list[float], percentile_value: float) -> float:
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, max(0, math.ceil(percentile_value * len(ordered)) - 1))]


async def run(backend: str, endpoint: str, output_dir: Path, iterations: int) -> dict[str, object]:
    adapter = (LoopbackKokoroTtsAdapter if backend == "kokoro" else LoopbackQwenTtsAdapter)(endpoint, timeout_s=60)
    health = await adapter.healthcheck()
    output_dir.mkdir(parents=True, exist_ok=True)
    results = []
    for iteration in range(iterations):
        for case_id, text, language, speaker in CASES:
            item = TtsRequest(f"turn-{iteration}-{case_id}", f"stream-{iteration}-{case_id}", text, language, speaker, deadline_ms=15_000)
            started = time.perf_counter()
            audio = await adapter.synthesize(item)
            elapsed_ms = (time.perf_counter() - started) * 1000
            audio.validate()
            if iteration == 0:
                write_pcm16(output_dir / f"{backend}-tts-{case_id}.wav", audio.samples, audio.sample_rate_hz)
            results.append({
                "iteration": iteration + 1,
                "id": case_id,
                "language": language,
                "sampleRateHz": audio.sample_rate_hz,
                "frames": len(audio.samples),
                "durationMs": round(audio.duration_ms, 3),
                "synthesisMs": round(elapsed_ms, 3),
                "firstAudioMs": round(elapsed_ms, 3),
                "realTimeFactor": round(elapsed_ms / audio.duration_ms, 4),
                "finite": True,
                "nonEmpty": True,
            })
    timings = [float(item["synthesisMs"]) for item in results]
    return {
        "status": "pass",
        "backend": backend,
        "model": health.get("model"),
        "revision": adapter.model_revision,
        "service": health,
        "cases": results,
        "medianSynthesisMs": round(statistics.median(timings), 3),
        "p95SynthesisMs": round(percentile(timings, 0.95), 3),
        "gpu": gpu_snapshot(),
        "artifacts": [str(output_dir / f"{backend}-tts-{case_id}.wav") for case_id, *_ in CASES],
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--backend", choices=("qwen", "kokoro"), default="qwen")
    parser.add_argument("--endpoint")
    parser.add_argument("--iterations", type=int, default=1)
    parser.add_argument("--output-dir", type=Path, default=Path(".runtime-data/tts-smoke"))
    args = parser.parse_args()
    try:
        if not 1 <= args.iterations <= 20:
            raise ValueError("iterations must be between 1 and 20")
        endpoint = args.endpoint or ("http://127.0.0.1:8771" if args.backend == "kokoro" else "http://127.0.0.1:8770")
        result = asyncio.run(run(args.backend, endpoint, args.output_dir, args.iterations))
    except Exception as exc:
        print(json.dumps({"status": "fail", "errorType": type(exc).__name__, "message": str(exc)}))
        return 1
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
