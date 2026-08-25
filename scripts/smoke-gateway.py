from __future__ import annotations

import json
import os
from pathlib import Path
import struct
import subprocess
import sys
import time

from websockets.sync.client import connect


ROOT = Path(__file__).resolve().parents[1]
SMOKE_PORT = 18765
URL = f"ws://127.0.0.1:{SMOKE_PORT}/ws"


def connect_with_retry(process: subprocess.Popen[str]):
    last_error: Exception | None = None
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        if process.poll() is not None:
            output = process.stdout.read() if process.stdout else ""
            raise RuntimeError(f"gateway exited before readiness ({process.returncode}): {output}")
        try:
            return connect(URL, open_timeout=1)
        except Exception as error:
            last_error = error
            time.sleep(0.25)
    raise RuntimeError(f"gateway did not become ready: {last_error}")


def collect_response(websocket, *, timeout=3):
    events = []
    binary = []
    while not (
        any(event["type"] == "TEXT_DELTA" and event.get("isFinal") for event in events)
        and events[-1].get("type") == "AGENT_STATE"
        and events[-1].get("state") == "idle"
    ):
        message = websocket.recv(timeout=timeout)
        if isinstance(message, bytes):
            binary.append(message)
        else:
            events.append(json.loads(message))
    return events, binary


def main() -> int:
    environment = os.environ.copy()
    environment.update({
        "RUNTIME_VAD_BACKEND": "energy",
        "RUNTIME_ASR_BACKEND": "fake",
        "RUNTIME_HERMES_BACKEND": "disabled",
        "RUNTIME_TTS_BACKEND": "deterministic",
        "RUNTIME_DETERMINISTIC_TTS_DURATION_MS": "2000",
        "RUNTIME_TTS_CHUNK_DELAY_MS": "100",
        "RUNTIME_PORT": str(SMOKE_PORT),
    })
    process = subprocess.Popen(
        [sys.executable, "server.py"],
        cwd=ROOT,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        env=environment,
    )
    try:
        with connect_with_retry(process) as websocket:
            websocket.send(
                json.dumps(
                    {
                        "type": "CLIENT_HELLO",
                        "protocolVersion": 2,
                        "sessionId": "gateway-smoke-session",
                        "lastSeq": None,
                    }
                )
            )
            manifest = json.loads(websocket.recv(timeout=2))
            state = json.loads(websocket.recv(timeout=2))
            orchestrators = [agent for agent in manifest["agents"] if agent.get("isOrchestrator")]
            assert manifest["type"] == "AGENT_MANIFEST"
            assert [agent["id"] for agent in orchestrators] == ["local-supervisor"]
            assert state["type"] == "AGENT_STATE" and state["agentId"] == "local-supervisor"

            websocket.send(
                json.dumps(
                    {
                        "type": "CAPTURE_START",
                        "sessionId": "gateway-smoke-session",
                        "captureId": "capture-smoke",
                        "format": {
                            "encoding": "pcm_s16le",
                            "sampleRateHz": 16000,
                            "channels": 1,
                            "frameMs": 20,
                        },
                    }
                )
            )
            speech = struct.pack("<320h", *([12000] * 320))
            silence = bytes(640)
            for _ in range(5):
                websocket.send(speech)
            for _ in range(25):
                websocket.send(silence)
            websocket.send(
                json.dumps(
                    {
                        "type": "CAPTURE_END",
                        "sessionId": "gateway-smoke-session",
                        "captureId": "capture-smoke",
                    }
                )
            )
            voice_events = []
            while not voice_events or voice_events[-1]["type"] != "STT_FINAL":
                voice_events.append(json.loads(websocket.recv(timeout=3)))
            voice_types = [event["type"] for event in voice_events]
            assert voice_types[0] == "USER_SPEECH_START"
            assert "STT_PARTIAL" in voice_types
            assert voice_types[-2:] == ["USER_SPEECH_END", "STT_FINAL"]
            assert voice_events[-1]["text"] == "test final"

            voice_route_events, voice_audio = collect_response(websocket)
            assert any(event["type"] == "TASK_COMPLETE" for event in voice_route_events)
            assert voice_audio and all(0 < len(chunk) <= 9600 and len(chunk) % 4 == 0 for chunk in voice_audio)
            voice_start = next(event for event in voice_route_events if event["type"] == "TTS_START")
            voice_end = next(event for event in voice_route_events if event["type"] == "TTS_END")
            assert voice_start["format"] == {"encoding": "pcm_f32le", "sampleRateHz": 24000, "channels": 1, "chunkFrames": 2400}
            assert voice_start["streamId"] == voice_end["streamId"] and voice_end["outcome"] == "COMPLETED"

            websocket.send(json.dumps({"type": "USER_TEXT", "turnId": "turn-text", "text": "Review the architecture docs"}))
            text_events, text_audio = collect_response(websocket)
            assert text_events[0]["type"] == "STT_FINAL"
            assert any(event["type"] == "TASK_COMPLETE" and event["agentId"] == "research" for event in text_events)
            assert text_audio

            websocket.send(json.dumps({"type": "USER_TEXT", "turnId": "turn-block", "text": "Publish this publicly"}))
            blocked_events, blocked_audio = collect_response(websocket)
            assert any(event["type"] == "TASK_STATE" and event["state"] == "BLOCKED_POLICY" for event in blocked_events)
            assert blocked_audio

            websocket.send(json.dumps({"type": "USER_TEXT", "turnId": "turn-interrupt", "text": "Review the architecture docs"}))
            interrupt_events = []
            interrupt_audio = []
            sent_interrupt = False
            while not (
                sent_interrupt
                and any(event["type"] == "COMMAND_ACK" for event in interrupt_events)
                and any(event["type"] == "TTS_END" and event.get("outcome") == "INTERRUPTED" for event in interrupt_events)
                and any(event["type"] == "USER_SPEECH_START" for event in interrupt_events)
            ):
                message = websocket.recv(timeout=3)
                if isinstance(message, bytes):
                    interrupt_audio.append(message)
                    if not sent_interrupt:
                        websocket.send(json.dumps({
                            "type": "CAPTURE_START",
                            "sessionId": "gateway-smoke-session",
                            "captureId": "capture-barge-in",
                            "format": {"encoding": "pcm_s16le", "sampleRateHz": 16000, "channels": 1, "frameMs": 20},
                        }))
                        for _ in range(5):
                            websocket.send(speech)
                        sent_interrupt = True
                else:
                    interrupt_events.append(json.loads(message))
            audio_count_at_end = len(interrupt_audio)
            websocket.send(json.dumps({"type": "PING", "timestamp": 123}))
            while True:
                message = websocket.recv(timeout=2)
                if isinstance(message, bytes):
                    interrupt_audio.append(message)
                elif json.loads(message).get("type") == "PONG":
                    break
            assert len(interrupt_audio) == audio_count_at_end
            assert any(event["type"] == "TASK_COMPLETE" for event in interrupt_events)
            assert any(event["type"] == "USER_SPEECH_START" for event in interrupt_events)
            speech_index = next(index for index, event in enumerate(interrupt_events) if event["type"] == "USER_SPEECH_START")
            interrupted_index = next(index for index, event in enumerate(interrupt_events) if event["type"] == "TTS_END" and event.get("outcome") == "INTERRUPTED")
            assert speech_index < interrupted_index

        with connect(URL, open_timeout=1) as websocket:
            websocket.send(
                json.dumps(
                    {
                        "type": "CLIENT_HELLO",
                        "protocolVersion": 99,
                        "sessionId": "unsupported-version-session",
                    }
                )
            )
            error = json.loads(websocket.recv(timeout=2))
            assert error["type"] == "ERROR"
            assert error["code"] == "UNSUPPORTED_PROTOCOL_VERSION"

        print("gateway smoke passed: correlated PCM TTS, authoritative-VAD barge-in isolation, local manifest, shared orchestration, policy block, and version rejection")
        return 0
    finally:
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=5)


if __name__ == "__main__":
    raise SystemExit(main())
