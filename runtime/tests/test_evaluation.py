from __future__ import annotations

import unittest

from runtime.evaluation import (
    chinese_units,
    edit_distance,
    english_units,
    evaluate_release_thresholds,
    mixed_units,
    normalize_text,
    score_asr_case,
    summarize_asr,
    summarize_latencies,
)


class EvaluationTests(unittest.TestCase):
    def test_normalization_and_language_units(self):
        self.assertEqual(normalize_text("  听我说！ TypeScript  "), "听我说 typescript")
        self.assertEqual(chinese_units("听我说 TypeScript"), ["听", "我", "说"])
        self.assertEqual(english_units("Fix TypeScript API-v2"), ["fix", "typescript", "api-v2"])
        self.assertEqual(mixed_units("帮我 review API-v2"), ["帮", "我", "review", "api-v2"])

    def test_edit_distance_vectors(self):
        self.assertEqual(edit_distance("kitten", "sitting"), 3)
        self.assertEqual(edit_distance([], []), 0)
        self.assertEqual(edit_distance(["a"], []), 1)

    def test_group_scoring_and_thresholds(self):
        scores = [
            score_asr_case(case_id="zh", language="zh", reference="听我说", hypothesis="听我说", key_terms=["听我说"], expected_command="STOP", actual_command="STOP", expected_route="command", actual_route="command"),
            score_asr_case(case_id="en", language="en", reference="fix TypeScript", hypothesis="fix typescript", key_terms=["TypeScript"], expected_route="coding", actual_route="coding"),
            score_asr_case(case_id="mix", language="code-switch", reference="帮我 review API docs", hypothesis="帮我 review api docs", key_terms=["API"], expected_route="research", actual_route="research"),
        ]
        summary = summarize_asr(scores)
        self.assertEqual(summary["groups"]["zh"]["errorRate"], 0)
        self.assertTrue(evaluate_release_thresholds(summary)["passes"])

    def test_failure_and_empty_final_are_explicit(self):
        scores = [
            score_asr_case(case_id="zh", language="zh", reference="听我说", hypothesis="", key_terms=["听我说"], expected_command="STOP", actual_command=None),
            score_asr_case(case_id="en", language="en", reference="current status", hypothesis="wrong"),
            score_asr_case(case_id="mix", language="code-switch", reference="打开 API", hypothesis=""),
        ]
        result = evaluate_release_thresholds(summarize_asr(scores))
        self.assertFalse(result["passes"])
        self.assertFalse(result["checks"]["nonEmptyFinals"])

    def test_p99_is_only_reported_for_qualified_sample_size(self):
        small = summarize_latencies([1, 2, 3, 4])
        self.assertFalse(small["p99Qualified"])
        self.assertIsNone(small["p99Ms"])
        qualified = summarize_latencies(range(1_000))
        self.assertTrue(qualified["p99Qualified"])
        self.assertEqual(qualified["p99Ms"], 989.0)


if __name__ == "__main__":
    unittest.main()

