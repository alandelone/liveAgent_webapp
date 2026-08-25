from __future__ import annotations

import asyncio
import math
import unittest
from unittest.mock import patch

from runtime.response import ResponseCoordinator, choose_language, segment_clauses
from array import array

from runtime.tts import DeterministicTtsAdapter, LoopbackKokoroTtsAdapter, LoopbackQwenTtsAdapter, TtsAudio, TtsError, TtsRequest
from server import create_tts


class TtsTests(unittest.IsolatedAsyncioTestCase):
    def test_gateway_refuses_unverified_qwen_asr_tts_overlap(self):
        with patch.dict("os.environ", {"RUNTIME_TTS_BACKEND": "qwen-loopback", "RUNTIME_ASR_BACKEND": "qwen", "RUNTIME_TTS_ASR_CORESIDENCY_VERIFIED": "false"}, clear=False):
            with self.assertRaises(ValueError):
                create_tts()

    def test_kokoro_profile_accepts_only_explicit_local_ipv4_endpoints(self):
        adapter = LoopbackKokoroTtsAdapter("http://172.17.176.1:8771")
        self.assertEqual(adapter.endpoint, "http://172.17.176.1:8771")
        for endpoint in ("http://example.com:8771", "http://8.8.8.8:8771", "https://172.17.176.1:8771"):
            with self.subTest(endpoint=endpoint), self.assertRaises(ValueError):
                LoopbackKokoroTtsAdapter(endpoint)

    def test_gateway_selects_kokoro_without_unsafe_qwen_override(self):
        with patch.dict("os.environ", {"RUNTIME_TTS_BACKEND": "kokoro-loopback", "RUNTIME_TTS_ENDPOINT": "http://172.17.176.1:8771", "RUNTIME_ASR_BACKEND": "qwen"}, clear=False):
            self.assertIsInstance(create_tts(), LoopbackKokoroTtsAdapter)

    async def test_deterministic_tts_is_finite_bounded_and_exactly_chunked(self):
        adapter = DeterministicTtsAdapter(duration_ms=250)
        item = TtsRequest("turn", "stream", "你好，world", "Chinese", "Vivian")
        audio = await adapter.synthesize(item)
        audio.validate()
        self.assertEqual(audio.sample_rate_hz, 24_000)
        self.assertEqual(len(audio.samples), 6_000)
        self.assertTrue(all(math.isfinite(value) for value in audio.samples))
        self.assertEqual([len(chunk) for chunk in audio.chunks()], [9_600, 9_600, 4_800])

    async def test_validation_rejects_nonfinite_overlong_and_wrong_profile(self):
        with self.assertRaises(TtsError):
            TtsAudio(24_000, (float("nan"),)).validate()
        with self.assertRaises(TtsError):
            TtsAudio(16_000, (0.0,)).validate()
        with self.assertRaises(ValueError):
            TtsRequest("turn", "stream", "hello", "English", "Vivian").validate()

    async def test_loopback_adapter_validates_transport_headers(self):
        class FakeLoopback(LoopbackQwenTtsAdapter):
            def __init__(self, headers):
                super().__init__()
                self.headers = headers

            def _request(self, path, body):
                return array("f", [0.1, -0.2]).tobytes(), self.headers

        item = TtsRequest("turn", "stream", "hello", "English", "Ryan")
        valid = await FakeLoopback({"x-audio-encoding": "pcm_f32le", "x-sample-rate-hz": "24000"}).synthesize(item)
        self.assertAlmostEqual(valid.samples[0], 0.1, places=6)
        self.assertAlmostEqual(valid.samples[1], -0.2, places=6)
        with self.assertRaises(TtsError):
            await FakeLoopback({"x-audio-encoding": "wav", "x-sample-rate-hz": "24000"}).synthesize(item)


class ResponseTests(unittest.IsolatedAsyncioTestCase):
    def test_clause_segmentation_and_language_selection(self):
        self.assertEqual(segment_clauses("你好。 Hello!"), ("你好。", "Hello!"))
        self.assertEqual(segment_clauses("See `a.b` and https://example.com/a.b. Done."), ("See `a.b` and https://example.com/a.b. Done.",))
        self.assertEqual(choose_language("你好世界，这是说明 world"), ("Chinese", "Vivian"))
        self.assertEqual(choose_language("Hello 世界"), ("English", "Ryan"))
        self.assertTrue(all(len(clause) <= 220 for clause in segment_clauses("x" * 500)))

    async def test_response_orders_text_start_binary_end(self):
        timeline = []

        async def emit(event):
            timeline.append(event)

        async def binary(payload):
            timeline.append(payload)

        coordinator = ResponseCoordinator(emit, binary, tts=DeterministicTtsAdapter(duration_ms=100))
        await coordinator.deliver("turn", "Hello.")
        kinds = [item["type"] if isinstance(item, dict) else "BINARY" for item in timeline]
        self.assertEqual(kinds[0], "TEXT_DELTA")
        self.assertIn("TTS_START", kinds)
        self.assertIn("BINARY", kinds)
        self.assertLess(kinds.index("TTS_START"), kinds.index("BINARY"))
        self.assertLess(kinds.index("BINARY"), kinds.index("TTS_END"))
        self.assertEqual(next(item for item in timeline if isinstance(item, dict) and item["type"] == "TTS_END")["outcome"], "COMPLETED")

    async def test_disabled_tts_delivers_text_and_returns_idle(self):
        events = []

        async def emit(event):
            events.append(event)

        coordinator = ResponseCoordinator(emit)
        await coordinator.deliver("turn", "Text remains available.")
        self.assertEqual([event["type"] for event in events], ["TEXT_DELTA", "AGENT_STATE"])
        self.assertEqual(events[-1]["state"], "idle")

    async def test_interrupt_suppresses_late_binary_and_does_not_touch_tasks(self):
        events = []
        binary_started = asyncio.Event()
        release = asyncio.Event()
        binary_count = 0

        async def emit(event):
            events.append(event)

        async def binary(_payload):
            nonlocal binary_count
            binary_count += 1
            binary_started.set()
            await release.wait()

        coordinator = ResponseCoordinator(emit, binary, tts=DeterministicTtsAdapter(duration_ms=300))
        pending = asyncio.create_task(coordinator.deliver("turn", "Hello."))
        await binary_started.wait()
        self.assertTrue(await coordinator.interrupt())
        release.set()
        await pending
        self.assertEqual(binary_count, 1)
        endings = [event for event in events if event["type"] == "TTS_END"]
        self.assertEqual([event["outcome"] for event in endings], ["INTERRUPTED"])

    async def test_disconnect_abandon_suppresses_output_without_terminal_markers(self):
        events = []
        binary_started = asyncio.Event()
        release = asyncio.Event()

        async def emit(event):
            events.append(event)

        async def binary(_payload):
            binary_started.set()
            await release.wait()

        coordinator = ResponseCoordinator(emit, binary, tts=DeterministicTtsAdapter(duration_ms=300))
        pending = asyncio.create_task(coordinator.deliver("turn", "Hello."))
        await binary_started.wait()
        coordinator.abandon()
        release.set()
        await pending
        self.assertFalse(any(event["type"] == "TTS_END" for event in events))


if __name__ == "__main__":
    unittest.main()
