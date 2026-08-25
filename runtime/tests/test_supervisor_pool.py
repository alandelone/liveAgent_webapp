from __future__ import annotations

import asyncio
import json
from pathlib import Path
import unittest

from runtime.hermes import CircuitState, HermesEscalationAdapter, TransientHermesError
from runtime.orchestrator import LocalOrchestrator
from runtime.policy import ActionRequest, CommandRecognizer, CommandType, ExecutionPolicy, PolicyDecision, RiskClass
from runtime.scheduler import AgentDefinition, AgentRegistry, InvalidTransition, JobScheduler, JobState, QueueFull
from runtime.supervisor import DeterministicSupervisor, RouteDecision
from runtime.trace import new_trace


ROOT = Path(__file__).resolve().parents[2]
MANIFEST = json.loads((ROOT / "test-fixtures" / "v0.2" / "manifest.json").read_text(encoding="utf-8"))


class PolicyTests(unittest.TestCase):
    def test_exact_bilingual_commands_and_near_matches(self):
        recognizer = CommandRecognizer()
        self.assertEqual(recognizer.recognize("听我说！"), CommandType.STOP_SPEAKING)
        self.assertEqual(recognizer.recognize("Cancel the task."), CommandType.CANCEL_TASK)
        self.assertEqual(recognizer.recognize("告诉我 current status"), CommandType.STATUS)
        self.assertIsNone(recognizer.recognize("Please stop speaking after this explanation"))
        self.assertIsNone(recognizer.recognize("Can you cancel task creation logic?"))

    def test_all_policy_fixtures_and_no_unsafe_allow(self):
        policy = ExecutionPolicy()
        for fixture in MANIFEST["policy"]:
            with self.subTest(fixture["id"]):
                actual = policy.classify_fixture(fixture["text"])
                self.assertEqual(actual.decision.value, fixture["expectedDecision"])
        forged = policy.evaluate(ActionRequest("edit_workspace", "Publish publicly", RiskClass.EXTERNAL))
        self.assertEqual(forged.decision, PolicyDecision.BLOCKED_POLICY)


class SupervisorTests(unittest.IsolatedAsyncioTestCase):
    async def test_all_24_labeled_routes(self):
        supervisor = DeterministicSupervisor()
        for fixture in MANIFEST["routing"]:
            with self.subTest(fixture["id"]):
                decision = await supervisor.route(fixture["text"])
                self.assertEqual(decision.route, fixture["expectedRoute"])
                decision.validate(supervisor.roles)

    async def test_direct_target_validation_and_low_confidence_escalation(self):
        supervisor = DeterministicSupervisor()
        direct = await supervisor.route("do it", target_agent_id="coding")
        self.assertEqual(direct.worker_role, "coding")
        invalid = await supervisor.route("do it", target_agent_id="missing")
        self.assertEqual(invalid.route, "blocked")
        fallback = await supervisor.route("Explain a difficult ambiguous idea")
        self.assertEqual(fallback.route, "hermes")
        self.assertLess(fallback.confidence, 0.5)

    async def test_strict_route_schema(self):
        valid = {
            "route": "research", "reasonCode": "READ_ONLY_RESEARCH", "confidence": 0.8,
            "riskClass": "READ_ONLY", "costBand": "LOCAL_LOW", "deadlineMs": 1000,
            "workerRole": "research",
        }
        self.assertEqual(RouteDecision.from_wire(valid, frozenset({"research"})).route, "research")
        with self.assertRaises(ValueError):
            RouteDecision.from_wire({**valid, "privateReasoning": "leak"})
        with self.assertRaises(ValueError):
            RouteDecision.from_wire({**valid, "confidence": float("nan")})


class SchedulerTests(unittest.TestCase):
    def setUp(self):
        self.now = 1_000
        self.registry = AgentRegistry((
            AgentDefinition("local-supervisor", "Supervisor", "local-supervisor", "#000", "brain", True, 1, 2),
            AgentDefinition("worker", "Worker", "worker", "#111", "cpu", False, 1, 2),
        ))
        self.scheduler = JobScheduler(self.registry, global_queue_limit=2, global_concurrency=1, clock_ms=lambda: self.now)
        self.context = new_trace("session", "turn", now_ms=self.now, entropy=b"\0" * 10)

    def test_registry_invariant_and_manifest(self):
        with self.assertRaises(ValueError):
            AgentRegistry((AgentDefinition("worker", "Worker", "worker", "#111", "cpu"),))
        self.assertEqual(self.registry.public_manifest()[0]["id"], "local-supervisor")

    def test_queue_concurrency_transition_deadline_and_heartbeat(self):
        first = self.scheduler.submit(self.context, "worker", deadline_ms=1000)
        second = self.scheduler.submit(self.context, "worker", deadline_ms=1000)
        with self.assertRaises(QueueFull):
            self.scheduler.submit(self.context, "worker", deadline_ms=1000)
        self.assertEqual(self.scheduler.start_next().id, first.id)
        self.assertIsNone(self.scheduler.start_next())
        self.scheduler.heartbeat(first.id)
        self.now = 1_500
        expired = self.scheduler.expire(heartbeat_timeout_ms=500)
        self.assertEqual({item.state for item in expired}, {JobState.TIMED_OUT})
        self.assertEqual(self.scheduler.start_next().id, second.id)
        with self.assertRaises(InvalidTransition):
            self.scheduler.transition(first.id, JobState.COMPLETED)

    def test_cancellation_isolation_and_idempotency(self):
        root = self.scheduler.submit(self.context, "worker", deadline_ms=1000, idempotency_key="root")
        duplicate = self.scheduler.submit(self.context, "worker", deadline_ms=1000, idempotency_key="root")
        self.assertEqual(root.id, duplicate.id)
        self.scheduler.start_next()
        child = self.scheduler.submit(self.context, "worker", deadline_ms=1000, parent_job_id=root.id, cancellable=False)
        self.assertEqual(child.task_id, root.task_id)
        cancelled = self.scheduler.cancel_task(root.task_id)
        self.assertEqual([item.id for item in cancelled], [root.id])
        self.assertEqual(self.scheduler.jobs[child.id].state, JobState.QUEUED)

    def test_retry_budget(self):
        job = self.scheduler.submit(self.context, "worker", deadline_ms=1000, retry_budget=1)
        self.scheduler.start_next()
        self.scheduler.transition(job.id, JobState.FAILED)
        retry = self.scheduler.retry(job.id)
        self.assertEqual(retry.attempt, 2)
        self.scheduler.start_next()
        self.scheduler.transition(retry.id, JobState.FAILED)
        with self.assertRaises(InvalidTransition):
            self.scheduler.retry(retry.id)


class HermesTests(unittest.IsolatedAsyncioTestCase):
    async def test_retry_budget_circuit_and_half_open_recovery(self):
        now = 1_000
        outcomes = [TransientHermesError("down"), TransientHermesError("down"), "recovered"]

        async def transport(prompt, context, key):
            outcome = outcomes.pop(0)
            if isinstance(outcome, Exception):
                raise outcome
            self.assertEqual(context.trace_id, trace.trace_id)
            self.assertEqual(key, "idem")
            return outcome

        trace = new_trace("session", "turn", now_ms=now, entropy=b"\1" * 10)
        adapter = HermesEscalationAdapter(transport, retry_budget=0, session_budget=3, failure_threshold=2, cooldown_ms=100, clock_ms=lambda: now)
        self.assertEqual((await adapter.escalate("one", trace, idempotency_key="idem")).status, "degraded")
        self.assertEqual((await adapter.escalate("two", trace, idempotency_key="idem")).status, "degraded")
        self.assertEqual(adapter.state, CircuitState.OPEN)
        self.assertEqual((await adapter.escalate("blocked", trace, idempotency_key="idem")).reason_code, "CIRCUIT_OPEN")
        now = 1_100
        recovered = await adapter.escalate("probe", trace, idempotency_key="idem")
        self.assertEqual(recovered.status, "completed")
        self.assertEqual(adapter.state, CircuitState.CLOSED)

    async def test_timeout_and_cloud_budget(self):
        async def slow(prompt, context, key):
            await asyncio.sleep(0.05)
            return "late"
        trace = new_trace("session", "turn", now_ms=1, entropy=b"\2" * 10)
        adapter = HermesEscalationAdapter(slow, timeout_s=0.001, retry_budget=1, session_budget=1)
        result = await adapter.escalate("x", trace, idempotency_key="idem")
        self.assertEqual(result.attempts, 2)
        self.assertEqual((await adapter.escalate("x", trace, idempotency_key="idem")).reason_code, "CLOUD_BUDGET_EXHAUSTED")


class OrchestratorTests(unittest.IsolatedAsyncioTestCase):
    async def test_policy_block_and_local_route_share_entrypoint(self):
        events = []
        orchestrator = LocalOrchestrator(events.append_async if hasattr(events, "append_async") else self._emitter(events))
        blocked = await orchestrator.handle_turn("session", "turn-1", "Publish this publicly")
        self.assertEqual(blocked.state, "BLOCKED_POLICY")
        allowed = await orchestrator.handle_turn("session", "turn-2", "Review the architecture docs")
        self.assertEqual(allowed.state, "COMPLETED")
        self.assertTrue(any(event["type"] == "TASK_COMPLETE" for event in events))

    async def test_interrupt_does_not_cancel_background_job(self):
        events = []
        orchestrator = LocalOrchestrator(self._emitter(events))
        context = new_trace("session", "turn", now_ms=1, entropy=b"\3" * 10)
        job = orchestrator.scheduler.submit(context, "research", deadline_ms=1000)
        await orchestrator.interrupt_response("command")
        self.assertEqual(orchestrator.scheduler.jobs[job.id].state, JobState.QUEUED)

    async def test_task_cancel_suppresses_late_hermes_response(self):
        events = []
        started = asyncio.Event()
        release = asyncio.Event()

        async def transport(prompt, context, key):
            started.set()
            await release.wait()
            return "late response"

        hermes = HermesEscalationAdapter(transport, retry_budget=0, session_budget=1)
        orchestrator = LocalOrchestrator(self._emitter(events), hermes=hermes)
        pending = asyncio.create_task(orchestrator.handle_turn("session", "turn", "Explain an ambiguous difficult idea"))
        await started.wait()
        job = next(iter(orchestrator.scheduler.jobs.values()))
        await orchestrator.cancel_task(job.task_id, "cancel")
        release.set()
        result = await pending
        self.assertEqual(result.state, "CANCELLED")
        self.assertFalse(any(event["type"] == "TEXT_DELTA" and event.get("delta") == "late response" for event in events))

    @staticmethod
    def _emitter(events):
        async def emit(event):
            events.append(event)
        return emit


if __name__ == "__main__":
    unittest.main()
