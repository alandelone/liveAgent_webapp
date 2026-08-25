from __future__ import annotations

import json
from pathlib import Path
import tempfile
import time
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from runtime.benchmark import percentile
from runtime.structured_log import BoundedLogBuffer, JsonlSink


def main() -> int:
    turns = 500
    records_per_turn = 40
    buffer = BoundedLogBuffer(capacity=10_000)
    enqueue_ms: list[float] = []
    written = 0

    with tempfile.TemporaryDirectory() as directory:
        sink_path = Path(directory) / "structural.jsonl"
        sink = JsonlSink(sink_path)
        for turn in range(turns):
            for record_index in range(records_per_turn):
                started = time.perf_counter_ns()
                buffer.enqueue(
                    "structural",
                    {
                        "type": "job_state",
                        "trace_id": f"trace-{turn:04d}",
                        "session_id": "benchmark-session",
                        "turn_id": f"turn-{turn:04d}",
                        "task_id": f"task-{turn:04d}",
                        "job_id": f"job-{turn:04d}-{record_index:02d}",
                        "state": "RUNNING" if record_index < records_per_turn - 1 else "COMPLETED",
                    },
                )
                enqueue_ms.append((time.perf_counter_ns() - started) / 1_000_000)
                if len(buffer.records) >= 256:
                    written += sink.write(buffer.drain())
        written += sink.write(buffer.drain())
        bytes_written = sink_path.stat().st_size

    result = {
        "turns": turns,
        "recordsPerTurn": records_per_turn,
        "recordsWritten": written,
        "structuralBytes": bytes_written,
        "structuralMiB": round(bytes_written / 1024 / 1024, 3),
        "enqueueP95Ms": round(percentile(enqueue_ms, 0.95), 4),
        "dropped": buffer.dropped,
        "limits": {"maxMiB": 45, "maxEnqueueP95Ms": 2, "protectedDrops": 0},
    }
    result["status"] = (
        "pass"
        if result["structuralMiB"] <= 45
        and result["enqueueP95Ms"] <= 2
        and sum(buffer.dropped.values()) == 0
        else "fail"
    )
    print(json.dumps(result, indent=2))
    return 0 if result["status"] == "pass" else 1


if __name__ == "__main__":
    raise SystemExit(main())
