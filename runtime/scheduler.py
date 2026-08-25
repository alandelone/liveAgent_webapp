from __future__ import annotations

from dataclasses import dataclass, field, replace
from enum import StrEnum
import time
from typing import Callable

from runtime.trace import TraceContext, uuid7


class JobState(StrEnum):
    QUEUED = "QUEUED"
    RUNNING = "RUNNING"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"
    CANCELLED = "CANCELLED"
    TIMED_OUT = "TIMED_OUT"
    BLOCKED_POLICY = "BLOCKED_POLICY"


TERMINAL_STATES = frozenset({JobState.COMPLETED, JobState.FAILED, JobState.CANCELLED, JobState.TIMED_OUT, JobState.BLOCKED_POLICY})
TRANSITIONS = {
    JobState.QUEUED: frozenset({JobState.RUNNING, JobState.CANCELLED, JobState.TIMED_OUT, JobState.BLOCKED_POLICY}),
    JobState.RUNNING: frozenset({JobState.COMPLETED, JobState.FAILED, JobState.CANCELLED, JobState.TIMED_OUT}),
}


@dataclass(frozen=True, slots=True)
class AgentDefinition:
    id: str
    name: str
    role: str
    color: str
    icon: str
    is_orchestrator: bool = False
    concurrency: int = 1
    queue_limit: int = 16

    def __post_init__(self) -> None:
        if not self.id or not self.name or not self.role:
            raise ValueError("agent id, name, and role are required")
        if self.concurrency < 1 or self.queue_limit < 1:
            raise ValueError("agent bounds must be positive")


class AgentRegistry:
    def __init__(self, agents: tuple[AgentDefinition, ...]) -> None:
        ids = [agent.id for agent in agents]
        if len(ids) != len(set(ids)):
            raise ValueError("agent ids must be unique")
        if sum(agent.is_orchestrator for agent in agents) != 1:
            raise ValueError("manifest must contain exactly one orchestrator")
        self._agents = {agent.id: agent for agent in agents}

    @classmethod
    def default(cls) -> "AgentRegistry":
        return cls((
            AgentDefinition("local-supervisor", "Local Supervisor", "local-supervisor", "#6366F1", "brain", True, 1, 32),
            AgentDefinition("research", "Research", "research", "#A855F7", "book-open"),
            AgentDefinition("coding", "Coding", "coding", "#3B82F6", "code"),
            AgentDefinition("browser", "Browser", "browser", "#F59E0B", "globe"),
            AgentDefinition("filesystem-read", "Filesystem Read", "filesystem-read", "#06B6D4", "database"),
            AgentDefinition("hermes", "Hermes", "hermes", "#10B981", "cpu", False, 1, 8),
        ))

    @property
    def orchestrator(self) -> AgentDefinition:
        return next(agent for agent in self._agents.values() if agent.is_orchestrator)

    @property
    def roles(self) -> frozenset[str]:
        return frozenset(self._agents)

    def require(self, agent_id: str) -> AgentDefinition:
        try:
            return self._agents[agent_id]
        except KeyError as exc:
            raise ValueError(f"unknown agent: {agent_id}") from exc

    def public_manifest(self) -> list[dict[str, object]]:
        return [{"id": item.id, "name": item.name, "color": item.color, "icon": item.icon, "isOrchestrator": item.is_orchestrator} for item in self._agents.values()]


@dataclass(frozen=True, slots=True)
class Job:
    id: str
    task_id: str
    role: str
    context: TraceContext
    state: JobState
    created_ms: int
    deadline_ms: int
    heartbeat_ms: int
    attempt: int = 1
    retry_budget: int = 1
    parent_job_id: str | None = None
    cancellable: bool = True
    response_revision: int = 1
    idempotency_key: str | None = None
    result_summary: str | None = None
    reason_code: str | None = None

    @property
    def terminal(self) -> bool:
        return self.state in TERMINAL_STATES


class QueueFull(RuntimeError):
    pass


class InvalidTransition(RuntimeError):
    pass


class JobScheduler:
    def __init__(self, registry: AgentRegistry, *, global_queue_limit: int = 64, global_concurrency: int = 2, clock_ms: Callable[[], int] | None = None) -> None:
        if global_queue_limit < 1 or global_concurrency < 1:
            raise ValueError("scheduler bounds must be positive")
        self.registry = registry
        self.global_queue_limit = global_queue_limit
        self.global_concurrency = global_concurrency
        self.clock_ms = clock_ms or (lambda: int(time.time() * 1000))
        self.jobs: dict[str, Job] = {}
        self.queue: list[str] = []
        self.children: dict[str, list[str]] = {}
        self.idempotency: dict[str, str] = {}

    def submit(self, context: TraceContext, role: str, *, deadline_ms: int, retry_budget: int = 1, parent_job_id: str | None = None, cancellable: bool = True, response_revision: int = 1, idempotency_key: str | None = None) -> Job:
        agent = self.registry.require(role)
        if idempotency_key and idempotency_key in self.idempotency:
            return self.jobs[self.idempotency[idempotency_key]]
        if len(self.queue) >= self.global_queue_limit:
            raise QueueFull("global job queue is full")
        if sum(self.jobs[job_id].role == role for job_id in self.queue) >= agent.queue_limit:
            raise QueueFull(f"queue for {role} is full")
        parent = self.jobs.get(parent_job_id) if parent_job_id else None
        if parent_job_id and parent is None:
            raise ValueError("parent job does not exist")
        now = self.clock_ms()
        entropy = (len(self.jobs) + 1).to_bytes(10, "big")
        job_id = uuid7(now, entropy)
        task_id = context.task_id or (parent.task_id if parent else f"task-{job_id}")
        job_context = replace(context, task_id=task_id, job_id=job_id, parent_job_id=parent_job_id, agent_id=role, attempt=1)
        job_context.validate()
        job = Job(job_id, task_id, role, job_context, JobState.QUEUED, now, now + deadline_ms, now, 1, retry_budget, parent_job_id, cancellable, response_revision, idempotency_key)
        self.jobs[job_id] = job
        self.queue.append(job_id)
        if parent_job_id:
            self.children.setdefault(parent_job_id, []).append(job_id)
        if idempotency_key:
            self.idempotency[idempotency_key] = job_id
        return job

    def start_next(self) -> Job | None:
        running = [job for job in self.jobs.values() if job.state is JobState.RUNNING]
        if len(running) >= self.global_concurrency:
            return None
        for job_id in tuple(self.queue):
            job = self.jobs[job_id]
            agent = self.registry.require(job.role)
            if sum(item.state is JobState.RUNNING and item.role == job.role for item in self.jobs.values()) >= agent.concurrency:
                continue
            self.queue.remove(job_id)
            return self.transition(job_id, JobState.RUNNING)
        return None

    def transition(self, job_id: str, state: JobState, *, reason_code: str | None = None, result_summary: str | None = None) -> Job:
        job = self.jobs[job_id]
        if job.terminal or state not in TRANSITIONS.get(job.state, frozenset()):
            raise InvalidTransition(f"cannot transition {job.state} to {state}")
        updated = replace(job, state=state, heartbeat_ms=self.clock_ms(), reason_code=reason_code, result_summary=result_summary)
        self.jobs[job_id] = updated
        if job_id in self.queue and state is not JobState.QUEUED:
            self.queue.remove(job_id)
        return updated

    def heartbeat(self, job_id: str) -> Job:
        job = self.jobs[job_id]
        if job.state is not JobState.RUNNING:
            raise InvalidTransition("only running jobs accept heartbeats")
        updated = replace(job, heartbeat_ms=self.clock_ms())
        self.jobs[job_id] = updated
        return updated

    def expire(self, *, heartbeat_timeout_ms: int) -> list[Job]:
        now = self.clock_ms()
        expired: list[Job] = []
        for job in tuple(self.jobs.values()):
            deadline_hit = now >= job.deadline_ms
            heartbeat_hit = job.state is JobState.RUNNING and now - job.heartbeat_ms >= heartbeat_timeout_ms
            if not job.terminal and (deadline_hit or heartbeat_hit):
                expired.append(self.transition(job.id, JobState.TIMED_OUT, reason_code="DEADLINE" if deadline_hit else "HEARTBEAT_EXPIRED"))
        return expired

    def cancel_task(self, task_id: str) -> list[Job]:
        roots = [job for job in self.jobs.values() if job.task_id == task_id and job.parent_job_id is None]
        changed: list[Job] = []
        for root in roots:
            changed.extend(self._cancel_tree(root.id, force_root=True))
        return changed

    def _cancel_tree(self, job_id: str, *, force_root: bool = False) -> list[Job]:
        job = self.jobs[job_id]
        changed: list[Job] = []
        if not job.terminal and (force_root or job.cancellable):
            changed.append(self.transition(job_id, JobState.CANCELLED, reason_code="TASK_CANCEL"))
        for child_id in self.children.get(job_id, []):
            child = self.jobs[child_id]
            if child.cancellable:
                changed.extend(self._cancel_tree(child_id))
        return changed

    def retry(self, job_id: str) -> Job:
        previous = self.jobs[job_id]
        if previous.state not in {JobState.FAILED, JobState.TIMED_OUT}:
            raise InvalidTransition("only failed or timed-out jobs may retry")
        if previous.attempt > previous.retry_budget:
            raise InvalidTransition("retry budget exhausted")
        if previous.idempotency_key:
            del self.idempotency[previous.idempotency_key]
        retried = self.submit(previous.context.retry(), previous.role, deadline_ms=max(100, previous.deadline_ms - previous.created_ms), retry_budget=previous.retry_budget, parent_job_id=previous.parent_job_id, cancellable=previous.cancellable, response_revision=previous.response_revision, idempotency_key=previous.idempotency_key)
        retried = replace(retried, attempt=previous.attempt + 1, context=replace(retried.context, attempt=previous.attempt + 1))
        self.jobs[retried.id] = retried
        return retried

    @staticmethod
    def public_projection(job: Job) -> dict[str, object]:
        result: dict[str, object] = {"type": "TASK_STATE", "sessionId": job.context.session_id, "turnId": job.context.turn_id, "taskId": job.task_id, "agentId": job.role, "state": job.state.value}
        if job.reason_code:
            result["reasonCode"] = job.reason_code
        if job.result_summary:
            result["resultSummary"] = job.result_summary
        return result
