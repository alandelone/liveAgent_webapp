from __future__ import annotations

import json
from pathlib import Path
import tempfile
import unittest

import server

from runtime.benchmark import bootstrap_median_interval, latency_summary, percentile, wilson_interval
from runtime.fixture_validation import load_and_validate_manifest
from runtime.structured_log import BoundedLogBuffer, JsonlSink, LogBackpressure, reconstruct_job_tree, redact
from runtime.trace import new_trace, public_projection


ROOT = Path(__file__).resolve().parents[2]


class TraceTests(unittest.TestCase):
    def test_trace_propagation_retry_and_public_projection(self) -> None:
        root = new_trace("session-1", "turn-1", now_ms=1_700_000_000_000, entropy=bytes(range(10)))
        child = root.child_job(job_id="job-1", route_id="route-1", agent_id="coding", task_id="task-1")
        retry = child.retry()
        self.assertEqual(child.trace_id, root.trace_id)
        self.assertEqual(retry.attempt, 2)
        self.assertEqual(retry.parent_job_id, None)

        projected = public_projection({**retry.as_log_fields(), "type": "TASK_STATE", "state": "RUNNING"})
        self.assertEqual(projected, {"type": "TASK_STATE", "sessionId": "session-1", "turnId": "turn-1", "taskId": "task-1", "agentId": "coding", "state": "RUNNING"})

    def test_compatibility_gateway_manifest_uses_local_supervisor(self) -> None:
        manifest = server.load_agent_manifest()
        self.assertEqual(server.get_orchestrator_id(manifest), "local-supervisor")
        self.assertEqual([agent for agent in manifest if agent.get("isOrchestrator")], [manifest[0]])
        self.assertEqual(next(agent for agent in manifest if agent["id"] == "hermes")["isOrchestrator"], False)


class StructuredLogTests(unittest.TestCase):
    def test_redaction_priority_and_reconstruction(self) -> None:
        cleaned = redact({"authorization": "Bearer secret", "text": "a@b.com +6012-3456789 C:\\Users\\Alice\\x /home/bob/y KEYWORD"}, glossary_values=["KEYWORD"])
        self.assertEqual(cleaned["authorization"], "[REDACTED]")
        for raw in ("a@b.com", "+6012-3456789", "Alice", "bob", "KEYWORD"):
            self.assertNotIn(raw, cleaned["text"])

        buffer = BoundedLogBuffer(capacity=10)
        for index in range(8):
            buffer.enqueue("structural", {"index": index})
        buffer.enqueue("debug", {"ignored": True})
        self.assertEqual(buffer.dropped["debug"], 1)
        buffer.enqueue("structural", {"index": 8})
        buffer.enqueue("structural", {"index": 9})
        with self.assertRaises(LogBackpressure):
            buffer.enqueue("error", {"message": "full"})

        tree = reconstruct_job_tree([
            {"job_id": "root"}, {"job_id": "child", "parent_job_id": "root", "attempt": 1},
            {"job_id": "child", "parent_job_id": "root", "attempt": 2},
        ])
        self.assertEqual(tree, {"root": ["child"], "child": []})

    def test_jsonl_sink(self) -> None:
        buffer = BoundedLogBuffer(capacity=10)
        buffer.enqueue("structural", {"event": "route", "job_id": "job-1"})
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "events.jsonl"
            self.assertEqual(JsonlSink(path).write(buffer.drain()), 1)
            record = json.loads(path.read_text(encoding="utf-8"))
            self.assertEqual(record["category"], "structural")


class FixtureAndStatisticsTests(unittest.TestCase):
    def test_fixture_manifest_and_pcm(self) -> None:
        manifest = load_and_validate_manifest(ROOT / "test-fixtures" / "v0.2" / "manifest.json")
        self.assertEqual(len(manifest["routing"]), 24)
        self.assertEqual(len(manifest["policy"]), 12)

    def test_statistics_are_deterministic(self) -> None:
        self.assertEqual(percentile([1, 2, 3, 4, 5], 0.95), 5)
        low, high = wilson_interval(90, 100)
        self.assertAlmostEqual(low, 0.8256, places=4)
        self.assertAlmostEqual(high, 0.9448, places=4)
        self.assertEqual(bootstrap_median_interval([1, 2, 3, 4, 5], samples=200, seed=17), (1.0, 5.0))
        self.assertNotIn("p99", latency_summary(range(100)))
        self.assertIn("p99", latency_summary(range(1000)))


if __name__ == "__main__":
    unittest.main()
