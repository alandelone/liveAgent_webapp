from __future__ import annotations

from dataclasses import asdict, dataclass, replace
import os
import time
import uuid
from typing import Any, Mapping


PUBLIC_EVENT_FIELDS = frozenset(
    {
        "type",
        "seq",
        "sessionId",
        "timestamp",
        "turnId",
        "taskId",
        "agentId",
        "state",
        "progress",
        "message",
        "reasonCode",
        "resultSummary",
    }
)


def uuid7(now_ms: int | None = None, random_bytes: bytes | None = None) -> str:
    """Create an RFC 9562 UUIDv7 without depending on Python 3.14."""
    timestamp_ms = int(time.time() * 1000) if now_ms is None else now_ms
    if not 0 <= timestamp_ms < 2**48:
        raise ValueError("UUIDv7 timestamp must fit in 48 bits")
    entropy = os.urandom(10) if random_bytes is None else random_bytes
    if len(entropy) != 10:
        raise ValueError("UUIDv7 entropy must contain exactly 10 bytes")
    value = (timestamp_ms << 80) | (int.from_bytes(entropy, "big") & ((1 << 80) - 1))
    value &= ~(0xF << 76)
    value |= 0x7 << 76
    value &= ~(0x3 << 62)
    value |= 0x2 << 62
    return str(uuid.UUID(int=value))


@dataclass(frozen=True, slots=True)
class TraceContext:
    trace_id: str
    session_id: str
    turn_id: str
    revision_id: int = 1
    task_id: str | None = None
    job_id: str | None = None
    parent_job_id: str | None = None
    route_id: str | None = None
    agent_id: str | None = None
    attempt: int = 1

    def validate(self) -> None:
        for field_name in ("trace_id", "session_id", "turn_id"):
            if not getattr(self, field_name):
                raise ValueError(f"{field_name} is required")
        if self.revision_id < 1:
            raise ValueError("revision_id must be at least 1")
        if self.attempt < 1:
            raise ValueError("attempt must be at least 1")
        if self.parent_job_id and not self.job_id:
            raise ValueError("parent_job_id requires job_id")

    def child_job(
        self,
        *,
        job_id: str,
        route_id: str,
        agent_id: str,
        task_id: str | None = None,
    ) -> "TraceContext":
        child = replace(
            self,
            task_id=task_id or self.task_id,
            job_id=job_id,
            parent_job_id=self.job_id,
            route_id=route_id,
            agent_id=agent_id,
            attempt=1,
        )
        child.validate()
        return child

    def retry(self) -> "TraceContext":
        if not self.job_id:
            raise ValueError("cannot retry a context without job_id")
        return replace(self, attempt=self.attempt + 1)

    def as_log_fields(self) -> dict[str, Any]:
        self.validate()
        return {key: value for key, value in asdict(self).items() if value is not None}


def new_trace(session_id: str, turn_id: str, *, now_ms: int | None = None, entropy: bytes | None = None) -> TraceContext:
    context = TraceContext(trace_id=uuid7(now_ms, entropy), session_id=session_id, turn_id=turn_id)
    context.validate()
    return context


def public_projection(event: Mapping[str, Any]) -> dict[str, Any]:
    """Whitelist public fields so internal routing identifiers cannot leak to the UI."""
    aliases = {
        "session_id": "sessionId",
        "turn_id": "turnId",
        "task_id": "taskId",
        "agent_id": "agentId",
    }
    projected: dict[str, Any] = {}
    for key, value in event.items():
        public_key = aliases.get(key, key)
        if public_key in PUBLIC_EVENT_FIELDS:
            projected[public_key] = value
    return projected
