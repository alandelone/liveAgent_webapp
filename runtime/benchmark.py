from __future__ import annotations

import math
import random
from statistics import median
from typing import Iterable


def percentile(values: Iterable[float], probability: float) -> float:
    ordered = sorted(values)
    if not ordered:
        raise ValueError("at least one value is required")
    if not 0 <= probability <= 1:
        raise ValueError("probability must be between 0 and 1")
    index = max(0, math.ceil(probability * len(ordered)) - 1)
    return float(ordered[index])


def wilson_interval(successes: int, total: int, z: float = 1.959963984540054) -> tuple[float, float]:
    if total <= 0 or not 0 <= successes <= total:
        raise ValueError("successes and total are invalid")
    proportion = successes / total
    denominator = 1 + z * z / total
    center = (proportion + z * z / (2 * total)) / denominator
    margin = z * math.sqrt(proportion * (1 - proportion) / total + z * z / (4 * total * total)) / denominator
    return center - margin, center + margin


def bootstrap_median_interval(
    values: Iterable[float], *, samples: int = 2_000, seed: int = 17
) -> tuple[float, float]:
    data = list(values)
    if not data or samples < 100:
        raise ValueError("non-empty data and at least 100 bootstrap samples are required")
    generator = random.Random(seed)
    medians = [median(generator.choices(data, k=len(data))) for _ in range(samples)]
    return percentile(medians, 0.025), percentile(medians, 0.975)


def latency_summary(values: Iterable[float]) -> dict[str, float | tuple[float, float]]:
    data = list(values)
    result: dict[str, float | tuple[float, float]] = {
        "median": float(median(data)),
        "p95": percentile(data, 0.95),
        "median95": bootstrap_median_interval(data),
    }
    if len(data) >= 1_000:
        result["p99"] = percentile(data, 0.99)
    return result

