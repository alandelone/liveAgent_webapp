from __future__ import annotations

import argparse
import io
import json
import os
from pathlib import Path
import statistics
import subprocess
import sys
import time
import urllib.request


MODEL = os.environ.get("QWEN_ASR_MODEL", "Qwen/Qwen3-ASR-1.7B")
AUDIO_URL = "https://qianwen-res.oss-cn-beijing.aliyuncs.com/Qwen3-ASR-Repo/asr_en.wav"
ROOT = Path(__file__).resolve().parents[1]


def gpu_memory_mib() -> int:
    output = subprocess.check_output(
        ["nvidia-smi", "--query-gpu=memory.used", "--format=csv,noheader,nounits"], text=True
    )
    return int(output.strip().splitlines()[0])


def load_audio():
    import numpy as np
    import soundfile as sf

    request = urllib.request.Request(AUDIO_URL, headers={"User-Agent": "livechat-agent-preflight/0.2"})
    with urllib.request.urlopen(request, timeout=60) as response:
        audio_bytes = response.read()
    with io.BytesIO(audio_bytes) as handle:
        waveform, sample_rate = sf.read(handle, dtype="float32", always_2d=False)
    waveform = np.asarray(waveform, dtype=np.float32)
    if sample_rate != 16_000:
        duration = waveform.shape[0] / float(sample_rate)
        old_axis = np.linspace(0.0, duration, num=waveform.shape[0], endpoint=False)
        new_axis = np.linspace(0.0, duration, num=round(duration * 16_000), endpoint=False)
        waveform = np.interp(new_axis, old_axis, waveform).astype(np.float32)
    return waveform


def worker(iterations: int) -> int:
    from huggingface_hub import model_info
    from qwen_asr import Qwen3ASRModel

    idle_mib = gpu_memory_mib()
    load_started = time.perf_counter()
    model = Qwen3ASRModel.LLM(
        model=MODEL,
        gpu_memory_utilization=0.88,
        max_new_tokens=64,
        max_model_len=4_096,
        max_num_seqs=1,
        max_num_batched_tokens=1_024,
        kv_cache_memory_bytes=536_870_912,
        limit_mm_per_prompt={"audio": 1},
        enforce_eager=True,
    )
    load_seconds = time.perf_counter() - load_started
    loaded_mib = gpu_memory_mib()
    waveform = load_audio()
    latencies_ms: list[float] = []
    transcripts: list[str] = []

    for _ in range(iterations):
        state = model.init_streaming_state(unfixed_chunk_num=2, unfixed_token_num=5, chunk_size_sec=2.0)
        started = time.perf_counter()
        step = 16_000
        for position in range(0, waveform.shape[0], step):
            model.streaming_transcribe(waveform[position : position + step], state)
        model.finish_streaming_transcribe(state)
        latencies_ms.append((time.perf_counter() - started) * 1000)
        transcripts.append(state.text.strip())

    if not all(transcripts):
        raise RuntimeError("Qwen3-ASR produced an empty final transcript")
    result = {
        "model": MODEL,
        "modelRevision": model_info(MODEL).sha,
        "iterations": iterations,
        "loadSeconds": round(load_seconds, 3),
        "latencyMs": [round(value, 3) for value in latencies_ms],
        "medianLatencyMs": round(statistics.median(latencies_ms), 3),
        "idleBoardMemoryMiB": idle_mib,
        "loadedBoardMemoryMiB": loaded_mib,
        "modelBoardDeltaMiB": loaded_mib - idle_mib,
        "transcript": transcripts[-1],
    }
    print("SMOKE_RESULT=" + json.dumps(result, ensure_ascii=False))
    return 0


def run_worker(python: str, iterations: int) -> dict:
    completed = subprocess.run(
        [python, __file__, "--worker", "--iterations", str(iterations)],
        capture_output=True,
        text=True,
    )
    if completed.returncode != 0:
        if completed.stdout:
            print(completed.stdout, file=sys.stdout, end="")
        if completed.stderr:
            print(completed.stderr, file=sys.stderr, end="")
        raise RuntimeError(f"ASR worker failed with exit code {completed.returncode}")
    line = next(
        (line for line in completed.stdout.splitlines() if line.startswith("SMOKE_RESULT=")),
        None,
    )
    if line is None:
        raise RuntimeError("ASR worker completed without SMOKE_RESULT evidence")
    return json.loads(line.removeprefix("SMOKE_RESULT="))


def orchestrate() -> int:
    python = sys.executable
    cold_results = []
    for index in range(3):
        print(f"starting cold ASR run {index + 1}/3", flush=True)
        cold_results.append(run_worker(python, 1))

    print("starting warm ASR run 10/10", flush=True)
    warm_result = run_worker(python, 10)
    revisions = {result["modelRevision"] for result in cold_results} | {warm_result["modelRevision"]}
    if len(revisions) != 1:
        raise RuntimeError(f"model revision changed during smoke test: {sorted(revisions)}")

    evidence = {
        "status": "pass",
        "python": sys.version.split()[0],
        "coldRuns": cold_results,
        "warmRun": warm_result,
        "recoveryMemoryMiB": 12_282 - max(
            [result["loadedBoardMemoryMiB"] for result in cold_results]
            + [warm_result["loadedBoardMemoryMiB"]]
        ),
    }
    print(json.dumps(evidence, ensure_ascii=False, indent=2))
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--worker", action="store_true")
    parser.add_argument("--iterations", type=int, default=1)
    args = parser.parse_args()
    return worker(args.iterations) if args.worker else orchestrate()


if __name__ == "__main__":
    raise SystemExit(main())
