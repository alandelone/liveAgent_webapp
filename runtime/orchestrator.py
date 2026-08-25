from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass

from runtime.hermes import HermesEscalationAdapter
from runtime.policy import ActionRequest, CommandRecognizer, CommandType, ExecutionPolicy, PolicyDecision, RiskClass
from runtime.response import BinaryCallback, ResponseCoordinator
from runtime.scheduler import AgentRegistry, JobScheduler, JobState
from runtime.supervisor import DeterministicSupervisor, SupervisorAdapter
from runtime.trace import new_trace
from runtime.tts import TtsAdapter


EventCallback = Callable[[dict], Awaitable[None]]


@dataclass(frozen=True, slots=True)
class TurnResult:
    task_id: str | None
    state: str
    text: str
    route: str


class LocalOrchestrator:
    def __init__(self, emit: EventCallback, *, emit_binary: BinaryCallback | None = None, tts: TtsAdapter | None = None, response_chunk_delay_s: float = 0.0, registry: AgentRegistry | None = None, supervisor: SupervisorAdapter | None = None, policy: ExecutionPolicy | None = None, scheduler: JobScheduler | None = None, hermes: HermesEscalationAdapter | None = None) -> None:
        self.emit = emit
        self.registry = registry or AgentRegistry.default()
        self.supervisor = supervisor or DeterministicSupervisor(self.registry.roles)
        self.policy = policy or ExecutionPolicy()
        self.scheduler = scheduler or JobScheduler(self.registry)
        self.hermes = hermes
        self.commands = CommandRecognizer()
        self.responses = ResponseCoordinator(
            emit,
            emit_binary,
            tts=tts,
            agent_id=self.registry.orchestrator.id,
            chunk_yield_delay_s=response_chunk_delay_s,
        )

    async def handle_turn(self, session_id: str, turn_id: str, text: str, *, target_agent_id: str | None = None) -> TurnResult:
        context = new_trace(session_id, turn_id)
        command = self.commands.recognize(text)
        if command:
            return await self._handle_command(command, turn_id)

        preflight_risk = self.policy.classify_text(text)
        if preflight_risk in {RiskClass.EXTERNAL, RiskClass.PAID, RiskClass.IRREVERSIBLE, RiskClass.HIGH_IMPACT}:
            return await self._blocked(context, text, preflight_risk)

        await self.emit({"type": "AGENT_STATE", "agentId": self.registry.orchestrator.id, "state": "thinking", "detail": "Routing with Local Supervisor..."})
        try:
            decision = await self.supervisor.route(text, target_agent_id=target_agent_id)
        except Exception:
            decision = await DeterministicSupervisor(self.registry.roles).route(text, target_agent_id=target_agent_id)

        if decision.route == "blocked":
            return await self._blocked(context, text, decision.risk_class, decision.reason_code)

        capability = {
            "research": "research_read",
            "filesystem_read": "list_files",
            "coding": "edit_workspace",
            "browser": "open_local_url",
            "hermes": "research_read",
        }.get(decision.route, "unknown")
        boundary = self.policy.evaluate(ActionRequest(capability, text, decision.risk_class))
        if not boundary.allowed:
            return await self._blocked(context, text, boundary.risk_class, boundary.reason_code)

        idempotency_key = f"{context.trace_id}:{turn_id}:{decision.worker_role}"
        job = self.scheduler.submit(context, decision.worker_role, deadline_ms=decision.deadline_ms, idempotency_key=idempotency_key)
        await self.emit({"type": "TASK_START", "taskId": job.task_id, "fromAgentId": self.registry.orchestrator.id, "toAgentId": decision.worker_role, "taskName": f"Routed: {decision.reason_code}"})
        running = self.scheduler.start_next()
        if running is None:
            return TurnResult(job.task_id, JobState.QUEUED.value, "Task queued.", decision.route)
        await self.emit(self.scheduler.public_projection(running))

        if decision.route == "hermes":
            if self.hermes is None:
                response = "Local fallback: Hermes escalation is unavailable; the request remains local and read-only."
                reason = "HERMES_NOT_CONFIGURED"
            else:
                escalated = await self.hermes.escalate(text, running.context, idempotency_key=idempotency_key)
                response, reason = escalated.text, escalated.reason_code
        else:
            response = self._local_result(decision.route)
            reason = "LOCAL_WORKER_COMPLETED"

        current = self.scheduler.jobs[job.id]
        if current.state is JobState.CANCELLED:
            return TurnResult(current.task_id, current.state.value, "", decision.route)
        completed = self.scheduler.transition(job.id, JobState.COMPLETED, reason_code=reason, result_summary=response)
        await self.emit({"type": "TASK_COMPLETE", "taskId": completed.task_id, "agentId": completed.role, "resultSummary": response})
        await self._emit_response(turn_id, response)
        return TurnResult(completed.task_id, completed.state.value, response, decision.route)

    async def interrupt_response(self, command_id: str) -> None:
        await self.responses.interrupt()
        await self.emit({"type": "COMMAND_ACK", "commandId": command_id, "commandType": "USER_INTERRUPT", "outcome": "ACCEPTED", "reasonCode": "RESPONSE_SCOPE_ONLY"})

    async def cancel_task(self, task_id: str, command_id: str) -> None:
        changed = self.scheduler.cancel_task(task_id)
        await self.emit({"type": "COMMAND_ACK", "commandId": command_id, "commandType": "TASK_CANCEL", "outcome": "ACCEPTED" if changed else "ALREADY_APPLIED", "reasonCode": "TASK_SCOPE"})
        for job in changed:
            await self.emit(self.scheduler.public_projection(job))

    async def _blocked(self, context, text: str, risk: RiskClass, reason_code: str | None = None) -> TurnResult:
        job = self.scheduler.submit(context, self.registry.orchestrator.id, deadline_ms=500)
        blocked = self.scheduler.transition(job.id, JobState.BLOCKED_POLICY, reason_code=reason_code or f"BLOCKED_{risk.value}")
        await self.emit(self.scheduler.public_projection(blocked))
        response = "BLOCKED_POLICY: this first release cannot execute consequential or non-allowlisted actions."
        await self._emit_response(context.turn_id, response)
        return TurnResult(blocked.task_id, blocked.state.value, response, "blocked")

    async def _handle_command(self, command: CommandType, turn_id: str) -> TurnResult:
        if command is CommandType.STOP_SPEAKING:
            await self.interrupt_response(f"text-{turn_id}")
            return TurnResult(None, "COMPLETED", "Speech response stopped; background tasks continue.", "command")
        if command is CommandType.CANCEL_TASK:
            active = next((job for job in reversed(tuple(self.scheduler.jobs.values())) if not job.terminal), None)
            if active:
                await self.cancel_task(active.task_id, f"text-{turn_id}")
                text = f"Cancelled task {active.task_id}."
            else:
                text = "There is no cancellable active task."
        elif command is CommandType.STATUS:
            active_count = sum(not job.terminal for job in self.scheduler.jobs.values())
            text = f"Local Supervisor is healthy; {active_count} active task(s)."
        elif command is CommandType.REPEAT:
            text = self.responses.last_response or "There is no previous response to repeat."
        else:
            text = "Continuing with the current session."
        await self._emit_response(turn_id, text)
        return TurnResult(None, "COMPLETED", text, "command")

    async def _emit_response(self, turn_id: str, text: str) -> None:
        await self.responses.deliver(turn_id, text)

    @staticmethod
    def _local_result(route: str) -> str:
        return {
            "research": "The read-only research worker accepted the request.",
            "filesystem_read": "The filesystem read worker accepted the request.",
            "coding": "The local reversible coding worker accepted the request.",
            "browser": "The local browser worker accepted the request.",
        }.get(route, "The Local Supervisor completed the bounded local route.")
