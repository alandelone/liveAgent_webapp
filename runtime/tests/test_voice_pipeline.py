from __future__ import annotations

import asyncio
import unittest

from runtime.asr import FakeStreamingAsrAdapter
from runtime.audio_ingress import AudioBackpressure, InvalidAudioFrame, SessionAudioIngress
from runtime.transcript import Glossary, TranscriptStabilizer
from runtime.vad import SequenceProbabilityAdapter, StreamingVad
from runtime.voice_session import VoiceSession


FORMAT = {
    "encoding": "pcm_s16le",
    "sampleRateHz": 16_000,
    "channels": 1,
    "frameMs": 20,
}
FRAME = bytes(640)


class AudioIngressTests(unittest.TestCase):
    def test_state_size_capacity_and_reset(self):
        ingress = SessionAudioIngress(max_frames=2)
        with self.assertRaises(InvalidAudioFrame):
            ingress.accept(FRAME)
        ingress.start("capture_1", FORMAT)
        with self.assertRaises(InvalidAudioFrame):
            ingress.accept(bytes(12))
        ingress.accept(FRAME)
        ingress.accept(FRAME)
        with self.assertRaises(AudioBackpressure):
            ingress.accept(FRAME)
        self.assertEqual(ingress.queue.qsize(), 0)
        ingress.start("capture_2", FORMAT)
        ingress.reset()
        self.assertIsNone(ingress.capture_id)

    def test_invalid_format_is_rejected(self):
        ingress = SessionAudioIngress()
        with self.assertRaises(InvalidAudioFrame):
            ingress.start("capture", {**FORMAT, "sampleRateHz": 48_000})


class VadTests(unittest.TestCase):
    def test_preroll_onset_and_endpoint_are_deterministic(self):
        vad = StreamingVad(
            SequenceProbabilityAdapter([0.0, 0.1, 0.9, 0.9, 0.8, 0.1, 0.1]),
            pre_roll_frames=3,
            onset_frames=2,
            endpoint_frames=2,
            max_utterance_frames=20,
        )
        actions = []
        for index in range(7):
            actions.extend(vad.accept(bytes([index]) * 640))
        self.assertEqual([action.kind for action in actions], [
            "speech_start",
            "speech_audio",
            "speech_audio",
            "speech_audio",
            "speech_audio",
            "speech_end",
        ])
        self.assertEqual(actions[0].frame_index, 2)
        self.assertEqual(len(actions[1].frames), 3)
        self.assertEqual(actions[-1].kind, "speech_end")

    def test_max_duration_forces_terminal_boundary(self):
        vad = StreamingVad(
            SequenceProbabilityAdapter([1.0] * 10),
            pre_roll_frames=1,
            onset_frames=1,
            endpoint_frames=5,
            max_utterance_frames=3,
        )
        kinds = [action.kind for _ in range(3) for action in vad.accept(FRAME)]
        self.assertIn("speech_start", kinds)
        self.assertIn("speech_end", kinds)


class TranscriptTests(unittest.TestCase):
    def test_stability_glossary_and_revision(self):
        stabilizer = TranscriptStabilizer(Glossary({"qwen": "Qwen", "code x": "Codex"}))
        first = stabilizer.update("open qwen")
        second = stabilizer.update("open qwen docs")
        revised = stabilizer.update("open qwen code x")
        final = stabilizer.finalize("open qwen code x")
        self.assertEqual(first.text, "open Qwen")
        self.assertTrue(second.stable_prefix.startswith("open "))
        self.assertTrue(revised.route_invalidated)
        self.assertEqual(final.text, "open Qwen Codex")
        self.assertEqual(final.tentative_suffix, "")

    def test_chinese_prefix_is_committed_conservatively(self):
        stabilizer = TranscriptStabilizer()
        stabilizer.update("请打开项目")
        result = stabilizer.update("请打开项目文档")
        self.assertEqual(result.stable_prefix, "请打开项")
        self.assertEqual(result.text, "请打开项目文档")


class VoiceSessionTests(unittest.IsolatedAsyncioTestCase):
    async def test_speech_start_interrupts_before_asr_initialization(self):
        events = []

        async def emit(event):
            events.append(event)

        class OrderingAsr(FakeStreamingAsrAdapter):
            def start_turn(self):
                self.assert_boundary_already_emitted()
                super().start_turn()

            @staticmethod
            def assert_boundary_already_emitted():
                if not events or events[0]["type"] != "USER_SPEECH_START":
                    raise AssertionError("speech boundary must be emitted before ASR initialization")

        session = VoiceSession(
            "session_order",
            StreamingVad(SequenceProbabilityAdapter([])),
            OrderingAsr([], ""),
            emit,
            turn_id_factory=lambda: "turn_order",
        )
        await session._handle_action("speech_start", ())
        self.assertEqual(events[0]["type"], "USER_SPEECH_START")

    async def test_fake_pipeline_emits_authoritative_order(self):
        events = []

        async def emit(event):
            events.append(event)

        vad = StreamingVad(
            SequenceProbabilityAdapter([0.9, 0.9, 0.8, 0.1, 0.1]),
            pre_roll_frames=2,
            onset_frames=2,
            endpoint_frames=2,
            max_utterance_frames=20,
        )
        session = VoiceSession(
            "session_test",
            vad,
            FakeStreamingAsrAdapter(["hello", "hello world"], "hello world"),
            emit,
            turn_id_factory=lambda: "turn_fixture",
        )
        await session.start_capture("capture_fixture", FORMAT)
        for _ in range(5):
            session.accept_audio(FRAME)
            await asyncio.sleep(0)
        await session.end_capture("capture_fixture")
        types = [event["type"] for event in events]
        self.assertEqual(types[0], "USER_SPEECH_START")
        self.assertIn("STT_PARTIAL", types)
        self.assertEqual(types[-2:], ["USER_SPEECH_END", "STT_FINAL"])
        self.assertEqual(events[-1]["text"], "hello world")


if __name__ == "__main__":
    unittest.main()
