from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
import time
from typing import Awaitable, Callable, Protocol

from runtime.trace import TraceContext


class CircuitState(StrEnum):
    CLOSED = "CLOSED"
    OPEN = "OPEN"
    HALF_OPEN = "HALF_OPEN"


class TransientHermesError(RuntimeError):
    pass


class HermesTransport(Protocol):
    async def __call__(self, prompt: str, context: TraceContext, idempotency_key: str) -> str: ...


@dataclass(frozen=True, slots=True)
class HermesResult:
    status: str
    text: str
    attempts: int
    reason_code: str


class HermesEscalationAdapter:
    def __init__(self, transport: HermesTransport, *, timeout_s: float = 30, retry_budget: int = 1, session_budget: int = 4, failure_threshold: int = 3, cooldown_ms: int = 60_000, clock_ms: Callable[[], int] | None = None) -> None:
        if timeout_s <= 0 or retry_budget < 0 or session_budget < 0 or failure_threshold < 1 or cooldown_ms < 1:
            raise ValueError("invalid Hermes bounds")
        self.transport = transport
        self.timeout_s = timeout_s
        self.retry_budget = retry_budget
        self.remaining_budget = session_budget
        self.failure_threshold = failure_threshold
        self.cooldown_ms = cooldown_ms
        self.clock_ms = clock_ms or (lambda: int(time.time() * 1000))
        self.state = CircuitState.CLOSED
        self.failure_count = 0
        self.opened_ms: int | None = None

    def _allow_call(self) -> bool:
        if self.state is CircuitState.OPEN:
            if self.opened_ms is not None and self.clock_ms() - self.opened_ms >= self.cooldown_ms:
                self.state = CircuitState.HALF_OPEN
                return True
            return False
        return True

    async def escalate(self, prompt: str, context: TraceContext, *, idempotency_key: str) -> HermesResult:
        import asyncio
        context.validate()
        if not idempotency_key:
            return HermesResult("degraded", "Local fallback: escalation requires an idempotency key.", 0, "MISSING_IDEMPOTENCY_KEY")
        if self.remaining_budget <= 0:
            return HermesResult("degraded", "Local fallback: cloud budget exhausted.", 0, "CLOUD_BUDGET_EXHAUSTED")
        if not self._allow_call():
            return HermesResult("degraded", "Local fallback: Hermes circuit is open.", 0, "CIRCUIT_OPEN")

        self.remaining_budget -= 1
        attempts = 0
        for attempts in range(1, self.retry_budget + 2):
            try:
                text = await asyncio.wait_for(self.transport(prompt, context, idempotency_key), timeout=self.timeout_s)
                if not text.strip():
                    raise TransientHermesError("empty response")
                self.failure_count = 0
                self.state = CircuitState.CLOSED
                self.opened_ms = None
                return HermesResult("completed", text.strip(), attempts, "HERMES_OK")
            except (TimeoutError, TransientHermesError):
                if attempts > self.retry_budget:
                    break
            except Exception:
                attempts = max(attempts, 1)
                break

        self.failure_count += 1
        if self.state is CircuitState.HALF_OPEN or self.failure_count >= self.failure_threshold:
            self.state = CircuitState.OPEN
            self.opened_ms = self.clock_ms()
        return HermesResult("degraded", "Local fallback: Hermes is temporarily unavailable.", attempts, "HERMES_UNAVAILABLE")
