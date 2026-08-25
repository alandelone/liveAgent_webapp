from __future__ import annotations

import argparse
import asyncio
import io
import json
import os
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
from runtime.tts import LoopbackKokoroTtsAdapter, LoopbackQwenTtsAdapter, LoopbackTtsAdapter, TtsRequest


AUDIO_URL = "https://qianwen-res.oss-cn-beijing.aliyuncs.com/Qwen3-ASR-Repo/asr_en.wav"


def board_memory_mib() -> int:
    output = subprocess.check_output(["nvidia-smi", "--query-gpu=memory.used", "--format=csv,noheader,nounits"], text=True)
    return int(output.strip().splitlines()[0])


def load_pcm() -> bytes:
    call = urllib.request.Request(AUDIO_URL, headers={"User-Agent": "livechat-agent/0.2"})
    with urllib.request.urlopen(call, timeout=60) as response:
        waveform, sample_rate = sf.read(io.BytesIO(response.read()), dtype="float32", always_2d=False)
    waveform = np.asarray(waveform, dtype=np.float32)
    if waveform.ndim > 1:
        waveform = waveform.mean(axis=1)
    if sample_rate != 16_000:
        duration = waveform.shape[0] / sample_rate
        waveform = np.interp(
            np.linspace(0, duration, round(duration * 16_000), endpoint=False),
            np.linspace(0, duration, waveform.shape[0], endpoint=False),
            waveform,
        ).astype(np.float32)
    return (np.clip(waveform, -1, 1) * 32767).astype("<i2").tobytes()


async def await_tts(adapter: LoopbackTtsAdapter, timeout_s: int = 90) -> dict[str, object]:
    deadline = time.monotonic() + timeout_s
    while True:
        try:
            return await adapter.healthcheck()
        except Exception:
            if time.monotonic() >= deadline:
                raise
            await asyncio.sleep(1)


def transcribe(adapter: QwenStreamingAsrAdapter, pcm: bytes) -> str:
    for offset in range(0, len(pcm), 640):
        adapter.accept_pcm(pcm[offset : offset + 640])
    return adapter.finish()


async def run(order: str, backend: str, endpoint: str, tts_python: str) -> dict[str, object]:
    pcm = await asyncio.to_thread(load_pcm)
    tts = (LoopbackKokoroTtsAdapter if backend == "kokoro" else LoopbackQwenTtsAdapter)(endpoint, timeout_s=90)
    service_process = None
    idle = board_memory_mib()
    if order == "tts-first":
        health = await await_tts(tts)
    else:
        health = None

    asr = QwenStreamingAsrAdapter()
    load_started = time.perf_counter()
    await asyncio.to_thread(asr.start_turn)
    asr_load_ms = (time.perf_counter() - load_started) * 1000
    after_asr_load = board_memory_mib()

    if order == "asr-first":
        service_script = "kokoro-tts-service.py" if backend == "kokoro" else "qwen-tts-service.py"
        device = "cpu" if backend == "kokoro" else "cuda:0"
        child_env = dict(os.environ)
        child_env["VIRTUAL_ENV"] = str(Path(tts_python).parent.parent)
        service_process = subprocess.Popen(
            [tts_python, str(ROOT / "scripts" / service_script), "--device", device],
            cwd=ROOT,
            env=child_env,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
        )
        try:
            health = await await_tts(tts)
        except Exception:
            service_process.terminate()
            service_process.wait(timeout=10)
            raise

    maximum_board = board_memory_mib()
    monitoring = True

    async def monitor() -> None:
        nonlocal maximum_board
        while monitoring:
            maximum_board = max(maximum_board, await asyncio.to_thread(board_memory_mib))
            await asyncio.sleep(0.1)

    monitor_task = asyncio.create_task(monitor())
    tts_item = TtsRequest("turn-overlap", "stream-overlap", "你好，the voice pipeline is running together.", "Chinese", "Vivian", deadline_ms=15_000)
    started = time.perf_counter()
    try:
        final, audio = await asyncio.gather(asyncio.to_thread(transcribe, asr, pcm), tts.synthesize(tts_item))
        elapsed_ms = (time.perf_counter() - started) * 1000
    finally:
        monitoring = False
        await monitor_task
        if service_process is not None:
            service_process.terminate()
            try:
                service_process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                service_process.kill()
                service_process.wait(timeout=5)

    if not final or not audio.samples:
        raise RuntimeError("overlap produced an empty ASR or TTS result")
    return {
        "status": "pass",
        "order": order,
        "ttsBackend": backend,
        "asrRevision": asr.MODEL_REVISION,
        "ttsRevision": tts.model_revision,
        "ttsService": health,
        "asrLoadMs": round(asr_load_ms, 3),
        "overlapElapsedMs": round(elapsed_ms, 3),
        "ttsDurationMs": round(audio.duration_ms, 3),
        "idleBoardMemoryMiB": idle,
        "afterAsrLoadBoardMemoryMiB": after_asr_load,
        "peakBoardMemoryMiB": maximum_board,
        "recoveryHeadroomMiB": 12_282 - maximum_board,
        "asrFinalNonEmpty": True,
        "ttsNonEmptyFinite": True,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--order", choices=("tts-first", "asr-first"), required=True)
    parser.add_argument("--tts-backend", choices=("qwen", "kokoro"), default="qwen")
    parser.add_argument("--endpoint")
    parser.add_argument("--tts-python")
    args = parser.parse_args()
    endpoint = args.endpoint or ("http://127.0.0.1:8771" if args.tts_backend == "kokoro" else "http://127.0.0.1:8770")
    tts_python = args.tts_python or ("/opt/livechat-agent/.venv-tts-fast/bin/python" if args.tts_backend == "kokoro" else "/opt/livechat-agent/.venv-tts/bin/python")
    try:
        result = asyncio.run(run(args.order, args.tts_backend, endpoint, tts_python))
    except Exception as exc:
        print(json.dumps({"status": "fail", "order": args.order, "errorType": type(exc).__name__, "message": str(exc)}))
        return 1
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
