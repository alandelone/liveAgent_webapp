from __future__ import annotations

from dataclasses import dataclass
import re
import unicodedata
from typing import Iterable

from .benchmark import latency_summary


_HAN = r"\u3400-\u4dbf\u4e00-\u9fff"
_LATIN_TOKEN = r"[a-z0-9]+(?:[._/+:-][a-z0-9]+)*"


def normalize_text(text: str) -> str:
    value = unicodedata.normalize("NFKC", text).casefold()
    value = re.sub(rf"[^a-z0-9{_HAN}._/+:-]+", " ", value)
    return re.sub(r"\s+", " ", value).strip()


def chinese_units(text: str) -> list[str]:
    return re.findall(rf"[{_HAN}]", normalize_text(text))


def english_units(text: str) -> list[str]:
    return re.findall(_LATIN_TOKEN, normalize_text(text))


def mixed_units(text: str) -> list[str]:
    return re.findall(rf"[{_HAN}]|{_LATIN_TOKEN}", normalize_text(text))


def edit_distance(reference: Iterable[str], hypothesis: Iterable[str]) -> int:
    left = list(reference)
    right = list(hypothesis)
    previous = list(range(len(right) + 1))
    for left_index, left_item in enumerate(left, start=1):
        current = [left_index]
        for right_index, right_item in enumerate(right, start=1):
            current.append(
                min(
                    current[-1] + 1,
                    previous[right_index] + 1,
                    previous[right_index - 1] + (left_item != right_item),
                )
            )
        previous = current
    return previous[-1]


def error_rate(reference: Iterable[str], hypothesis: Iterable[str]) -> tuple[int, int, float]:
    reference_units = list(reference)
    hypothesis_units = list(hypothesis)
    edits = edit_distance(reference_units, hypothesis_units)
    if not reference_units:
        return edits, 0, 0.0 if not hypothesis_units else 1.0
    return edits, len(reference_units), edits / len(reference_units)


def language_units(language: str, text: str) -> list[str]:
    if language == "zh":
        return chinese_units(text)
    if language == "en":
        return english_units(text)
    if language == "code-switch":
        return mixed_units(text)
    raise ValueError(f"unsupported language group: {language}")


@dataclass(frozen=True, slots=True)
class AsrCaseScore:
    case_id: str
    language: str
    reference: str
    hypothesis: str
    edits: int
    reference_units: int
    error_rate: float
    key_terms_found: int
    key_terms_total: int
    command_correct: bool | None
    route_correct: bool | None
    terminal_correct: bool
    empty_final: bool


def score_asr_case(
    *,
    case_id: str,
    language: str,
    reference: str,
    hypothesis: str,
    key_terms: Iterable[str] = (),
    expected_command: str | None = None,
    actual_command: str | None = None,
    expected_route: str | None = None,
    actual_route: str | None = None,
    terminal_correct: bool = True,
) -> AsrCaseScore:
    edits, reference_count, rate = error_rate(
        language_units(language, reference),
        language_units(language, hypothesis),
    )
    normalized_hypothesis = normalize_text(hypothesis)
    terms = list(key_terms)
    found = sum(normalize_text(term) in normalized_hypothesis for term in terms)
    return AsrCaseScore(
        case_id=case_id,
        language=language,
        reference=reference,
        hypothesis=hypothesis,
        edits=edits,
        reference_units=reference_count,
        error_rate=rate,
        key_terms_found=found,
        key_terms_total=len(terms),
        command_correct=None if expected_command is None else actual_command == expected_command,
        route_correct=None if expected_route is None else actual_route == expected_route,
        terminal_correct=terminal_correct,
        empty_final=not bool(normalized_hypothesis),
    )


def summarize_asr(scores: Iterable[AsrCaseScore]) -> dict[str, object]:
    items = list(scores)
    if not items:
        raise ValueError("at least one ASR case score is required")

    def summarize_group(group: list[AsrCaseScore]) -> dict[str, object]:
        edits = sum(item.edits for item in group)
        units = sum(item.reference_units for item in group)
        terms_found = sum(item.key_terms_found for item in group)
        terms_total = sum(item.key_terms_total for item in group)
        command_items = [item.command_correct for item in group if item.command_correct is not None]
        route_items = [item.route_correct for item in group if item.route_correct is not None]
        return {
            "cases": len(group),
            "edits": edits,
            "referenceUnits": units,
            "errorRate": edits / units if units else 0.0,
            "keyTermAccuracy": terms_found / terms_total if terms_total else 1.0,
            "commandAccuracy": sum(command_items) / len(command_items) if command_items else None,
            "routeAccuracy": sum(route_items) / len(route_items) if route_items else None,
            "terminalAccuracy": sum(item.terminal_correct for item in group) / len(group),
            "emptyFinals": sum(item.empty_final for item in group),
        }

    groups = {
        language: summarize_group([item for item in items if item.language == language])
        for language in ("zh", "en", "code-switch")
        if any(item.language == language for item in items)
    }
    overall = summarize_group(items)
    return {"groups": groups, "overall": overall}


def evaluate_release_thresholds(summary: dict[str, object]) -> dict[str, object]:
    groups = summary["groups"]
    overall = summary["overall"]
    checks = {
        "zhCer": groups["zh"]["errorRate"] <= 0.35,
        "enWer": groups["en"]["errorRate"] <= 0.30,
        "codeSwitchMer": groups["code-switch"]["errorRate"] <= 0.40,
        "overallKeyTerms": overall["keyTermAccuracy"] >= 0.85,
        "groupKeyTerms": all(group["keyTermAccuracy"] >= 0.75 for group in groups.values()),
        "commands": overall["commandAccuracy"] in (None, 1.0),
        "routes": overall["routeAccuracy"] in (None, 1.0),
        "terminals": overall["terminalAccuracy"] == 1.0,
        "nonEmptyFinals": overall["emptyFinals"] == 0,
    }
    return {"passes": all(checks.values()), "checks": checks}


def summarize_latencies(values_ms: Iterable[float]) -> dict[str, object]:
    values = list(values_ms)
    summary = latency_summary(values)
    return {
        "sampleCount": len(values),
        "p50Ms": summary["median"],
        "p95Ms": summary["p95"],
        "median95Ms": list(summary["median95"]),
        "p99Ms": summary.get("p99"),
        "p99Qualified": len(values) >= 1_000,
    }

