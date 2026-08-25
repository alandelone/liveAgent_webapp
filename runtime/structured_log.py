from __future__ import annotations

from collections import deque
from dataclasses import dataclass
import json
import re
from pathlib import Path
from typing import Any, Iterable, Mapping


MAX_RECORD_BYTES = 256 * 1024
SECRET_KEYS = frozenset({"authorization", "api_key", "apikey", "password", "secret", "token", "access_token"})
EMAIL_RE = re.compile(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", re.IGNORECASE)
PHONE_RE = re.compile(r"(?<!\w)(?:\+?\d[\d ()-]{7,}\d)(?!\w)")
BEARER_RE = re.compile(r"\bBearer\s+[A-Za-z0-9._~+/=-]+", re.IGNORECASE)
WINDOWS_HOME_RE = re.compile(r"[A-Za-z]:\\Users\\[^\\\s]+", re.IGNORECASE)
LINUX_HOME_RE = re.compile(r"/home/[^/\s]+")


class LogBackpressure(RuntimeError):
    pass


class OversizedLogRecord(ValueError):
    pass


def redact(value: Any, *, glossary_values: Iterable[str] = ()) -> Any:
    if isinstance(value, Mapping):
        return {
            str(key): "[REDACTED]" if str(key).lower() in SECRET_KEYS else redact(item, glossary_values=glossary_values)
            for key, item in value.items()
        }
    if isinstance(value, list):
        return [redact(item, glossary_values=glossary_values) for item in value]
    if not isinstance(value, str):
        return value

    redacted = BEARER_RE.sub("Bearer [REDACTED]", value)
    redacted = EMAIL_RE.sub("[REDACTED_EMAIL]", redacted)
    redacted = PHONE_RE.sub("[REDACTED_PHONE]", redacted)
    redacted = WINDOWS_HOME_RE.sub(r"C:\\Users\\[REDACTED]", redacted)
    redacted = LINUX_HOME_RE.sub("/home/[REDACTED]", redacted)
    for term in sorted((term for term in glossary_values if term), key=len, reverse=True):
        redacted = redacted.replace(term, "[REDACTED_GLOSSARY]")
    return redacted


@dataclass(frozen=True, slots=True)
class LogRecord:
    category: str
    payload: dict[str, Any]

    @property
    def protected(self) -> bool:
        return self.category in {"structural", "error"}


class BoundedLogBuffer:
    def __init__(self, capacity: int = 10_000, glossary_values: Iterable[str] = ()) -> None:
        if capacity < 10:
            raise ValueError("log capacity must be at least 10")
        self.capacity = capacity
        self.glossary_values = tuple(glossary_values)
        self.records: deque[LogRecord] = deque()
        self.dropped = {"debug": 0, "metric": 0}

    @property
    def occupancy(self) -> float:
        return len(self.records) / self.capacity

    def enqueue(self, category: str, payload: Mapping[str, Any]) -> None:
        if category not in {"debug", "metric", "structural", "error"}:
            raise ValueError(f"unsupported log category: {category}")
        clean = redact(dict(payload), glossary_values=self.glossary_values)
        encoded = json.dumps(clean, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        if len(encoded) > MAX_RECORD_BYTES:
            raise OversizedLogRecord(f"record is {len(encoded)} bytes; limit is {MAX_RECORD_BYTES}")

        if category == "debug" and self.occupancy >= 0.80:
            self.dropped["debug"] += 1
            return
        if category == "metric" and self.occupancy >= 0.90:
            self.dropped["metric"] += 1
            return

        if len(self.records) >= self.capacity:
            if category in {"debug", "metric"}:
                self.dropped[category] += 1
                return
            evict_index = next((index for index, record in enumerate(self.records) if not record.protected), None)
            if evict_index is None:
                raise LogBackpressure("protected log records exhausted the bounded queue")
            evicted = self.records[evict_index]
            del self.records[evict_index]
            self.dropped[evicted.category] += 1

        self.records.append(LogRecord(category=category, payload=clean))

    def drain(self, limit: int = 256) -> list[LogRecord]:
        batch: list[LogRecord] = []
        for _ in range(min(limit, len(self.records))):
            batch.append(self.records.popleft())
        return batch


class JsonlSink:
    def __init__(self, path: Path, max_bytes: int = 128 * 1024 * 1024) -> None:
        self.path = path
        self.max_bytes = max_bytes

    def write(self, records: Iterable[LogRecord]) -> int:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        if self.path.exists() and self.path.stat().st_size >= self.max_bytes:
            rotated = self.path.with_suffix(self.path.suffix + ".1")
            if rotated.exists():
                rotated.unlink()
            self.path.replace(rotated)
        count = 0
        with self.path.open("a", encoding="utf-8", newline="\n") as handle:
            for record in records:
                handle.write(json.dumps({"category": record.category, **record.payload}, ensure_ascii=False) + "\n")
                count += 1
        return count


def reconstruct_job_tree(records: Iterable[Mapping[str, Any]]) -> dict[str, list[str]]:
    tree: dict[str, list[str]] = {}
    for record in records:
        job_id = record.get("job_id")
        if not isinstance(job_id, str):
            continue
        tree.setdefault(job_id, [])
        parent = record.get("parent_job_id")
        if isinstance(parent, str):
            tree.setdefault(parent, [])
            if job_id not in tree[parent]:
                tree[parent].append(job_id)
    return tree

