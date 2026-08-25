from __future__ import annotations

from dataclasses import dataclass
import re


@dataclass(frozen=True)
class StabilizedTranscript:
    stable_prefix: str
    tentative_suffix: str
    revision_id: int
    route_invalidated: bool

    @property
    def text(self) -> str:
        return self.stable_prefix + self.tentative_suffix


class Glossary:
    def __init__(self, replacements: dict[str, str] | None = None):
        self.replacements = replacements or {}

    def apply(self, text: str) -> str:
        result = text
        for source in sorted(self.replacements, key=len, reverse=True):
            target = self.replacements[source]
            if source.isascii() and source.replace("-", "").isalnum():
                result = re.sub(rf"(?<![\w]){re.escape(source)}(?![\w])", target, result, flags=re.IGNORECASE)
            else:
                result = result.replace(source, target)
        return result


class TranscriptStabilizer:
    def __init__(self, glossary: Glossary | None = None):
        self.glossary = glossary or Glossary()
        self.stable_prefix = ""
        self.tentative_suffix = ""
        self.previous = ""
        self.revision_id = 0

    def update(self, hypothesis: str) -> StabilizedTranscript:
        current = self.glossary.apply(hypothesis.strip())
        common = self._common_prefix(self.previous, current)
        invalidated = bool(self.previous and common < len(self.stable_prefix + self.tentative_suffix))
        if invalidated:
            self.revision_id += 1
        commit_at = self._safe_commit_index(current, common)
        commit_at = max(len(self.stable_prefix), commit_at)
        if current.startswith(self.stable_prefix):
            self.stable_prefix = current[:commit_at]
            self.tentative_suffix = current[commit_at:]
        else:
            invalidated = True
            self.revision_id += 1
            current = self.stable_prefix + current[common:]
            self.tentative_suffix = current[len(self.stable_prefix) :]
        self.previous = current
        return self.snapshot(invalidated)

    def finalize(self, hypothesis: str | None = None) -> StabilizedTranscript:
        current = self.glossary.apply((hypothesis if hypothesis is not None else self.previous).strip())
        if current.startswith(self.stable_prefix):
            self.stable_prefix = current
        else:
            self.revision_id += 1
            self.stable_prefix = self.stable_prefix + current[self._common_prefix(self.stable_prefix, current) :]
        self.tentative_suffix = ""
        self.previous = self.stable_prefix
        return self.snapshot(False)

    def snapshot(self, invalidated: bool = False) -> StabilizedTranscript:
        return StabilizedTranscript(
            self.stable_prefix,
            self.tentative_suffix,
            self.revision_id,
            invalidated,
        )

    @staticmethod
    def _common_prefix(left: str, right: str) -> int:
        position = 0
        for a, b in zip(left, right):
            if a != b:
                break
            position += 1
        return position

    @staticmethod
    def _safe_commit_index(text: str, common: int) -> int:
        if common <= 1:
            return 0
        if common < len(text) and text[common].isspace():
            return common + 1
        prefix = text[:common]
        boundary = max(prefix.rfind(" "), prefix.rfind("/"), prefix.rfind("\\"))
        if boundary >= 0:
            return boundary + 1
        return common - 1
