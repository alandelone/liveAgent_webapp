from __future__ import annotations

import argparse
import asyncio
import gc
import json
from pathlib import Path
import subprocess
import time

from runtime.supervisor import MODEL_ID, MODEL_REVISION, QwenSupervisorAdapter


ROOT = Path(__file__).resolve().parents[1]


def board_memory_mib() -> int:
    executable = "/mnt/c/Windows/System32/nvidia-smi.exe"
    output = subprocess.check_output(
        [executable, "--query-gpu=memory.used", "--format=csv,noheader,nounits"],
        text=True,
    ).strip()
    return int(output.splitlines()[0].strip())


async def evaluate(quantization: str, device: str, model_path: str | None, limit: int | None, with_asr: bool, supervisor_first: bool) -> dict:
    fixtures = json.loads((ROOT / "test-fixtures" / "v0.2" / "manifest.json").read_text(encoding="utf-8"))["routing"]
    if limit is not None:
        fixtures = fixtures[:limit]
    before = board_memory_mib()
    adapter = QwenSupervisorAdapter(quantization=quantization, device=device, model_path=model_path, max_new_tokens=128)
    load_ms = None
    if supervisor_first:
        started = time.perf_counter()
        adapter.load()
        load_ms = (time.perf_counter() - started) * 1000
    asr_loaded = None
    if with_asr:
        from runtime.asr import QwenStreamingAsrAdapter
        asr = QwenStreamingAsrAdapter()
        asr.start_turn()
        asr.accept_pcm(bytes(32_000))
        asr.finish()
        asr_loaded = board_memory_mib()
    if load_ms is None:
        started = time.perf_counter()
        adapter.load()
        load_ms = (time.perf_counter() - started) * 1000
    loaded = board_memory_mib()
    model_device = str(adapter._model.device)
    if model_device.startswith("cuda"):
        import torch
        process_allocated = round(torch.cuda.memory_allocated() / 1024 / 1024)
    else:
        process_allocated = 0
    results = []
    for fixture in fixtures:
        route_started = time.perf_counter()
        try:
            decision = await adapter.route(fixture["text"])
            actual = decision.route
            schema_valid = True
            error = None
        except Exception as exc:
            actual = None
            schema_valid = False
            error = f"{type(exc).__name__}: {exc}"
        results.append({
            "id": fixture["id"],
            "expected": fixture["expectedRoute"],
            "actual": actual,
            "schemaValid": schema_valid,
            "correct": actual == fixture["expectedRoute"],
            "latencyMs": round((time.perf_counter() - route_started) * 1000, 3),
            "error": error,
        })
    latencies = sorted(item["latencyMs"] for item in results)
    accuracy = sum(item["correct"] for item in results) / len(results)
    return {
        "status": "pass" if all(item["schemaValid"] for item in results) and accuracy >= 0.875 else "fail",
        "model": MODEL_ID,
        "revision": MODEL_REVISION,
        "quantization": quantization,
        "device": device,
        "modelPath": model_path,
        "supervisorFirst": supervisor_first,
        "sampleCount": len(results),
        "schemaValidCount": sum(item["schemaValid"] for item in results),
        "correctCount": sum(item["correct"] for item in results),
        "accuracy": accuracy,
        "requiredAccuracy": 0.875,
        "loadMs": round(load_ms, 3),
        "p50RouteMs": latencies[len(latencies) // 2],
        "beforeBoardMemoryMiB": before,
        "asrLoadedBoardMemoryMiB": asr_loaded,
        "loadedBoardMemoryMiB": loaded,
        "supervisorProcessAllocatedMiB": process_allocated,
        "modelDevice": model_device,
        "results": results,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--quantization", choices=("bf16", "nf4"), required=True)
    parser.add_argument("--device", choices=("cuda", "cpu"), default="cuda")
    parser.add_argument("--model-path")
    parser.add_argument("--limit", type=int)
    parser.add_argument("--with-asr", action="store_true")
    parser.add_argument("--supervisor-first", action="store_true")
    args = parser.parse_args()
    result = asyncio.run(evaluate(args.quantization, args.device, args.model_path, args.limit, args.with_asr, args.supervisor_first))
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["status"] == "pass" else 1


if __name__ == "__main__":
    raise SystemExit(main())
