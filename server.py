from __future__ import annotations

import asyncio
import json
import os
import time

import websockets

from runtime.asr import create_asr_adapter
from runtime.audio_ingress import AudioBackpressure, InvalidAudioFrame
from runtime.orchestrator import LocalOrchestrator
from runtime.scheduler import AgentRegistry
from runtime.supervisor import DeterministicSupervisor, QwenSupervisorAdapter
from runtime.tts import DeterministicTtsAdapter, DisabledTtsAdapter, LoopbackKokoroTtsAdapter, LoopbackTtsAdapter, LoopbackQwenTtsAdapter
from runtime.vad import EnergyProbabilityAdapter, SileroProbabilityAdapter, StreamingVad
from runtime.voice_session import VoiceSession


PORT = int(os.environ.get("RUNTIME_PORT", "8765"))


def create_vad() -> StreamingVad:
    backend = os.environ.get("RUNTIME_VAD_BACKEND", "energy").lower()
    if backend == "silero":
        return StreamingVad(SileroProbabilityAdapter())
    if backend == "energy":
        return StreamingVad(EnergyProbabilityAdapter())
    raise ValueError(f"unsupported RUNTIME_VAD_BACKEND: {backend}")


def create_supervisor(registry: AgentRegistry):
    backend = os.environ.get("RUNTIME_SUPERVISOR_BACKEND", "deterministic").lower()
    if backend == "qwen":
        if os.environ.get("RUNTIME_ASR_BACKEND", "fake").lower() == "qwen":
            raise ValueError("target-host evidence forbids concurrent qwen ASR and qwen Supervisor in one profile")
        return QwenSupervisorAdapter(
            quantization=os.environ.get("RUNTIME_SUPERVISOR_QUANTIZATION", "nf4").lower(),
            device=os.environ.get("RUNTIME_SUPERVISOR_DEVICE", "cuda").lower(),
            model_path=os.environ.get("RUNTIME_SUPERVISOR_MODEL_PATH") or None,
            allowed_roles=registry.roles,
        )
    if backend == "deterministic":
        return DeterministicSupervisor(registry.roles)
    raise ValueError(f"unsupported RUNTIME_SUPERVISOR_BACKEND: {backend}")


def create_tts():
    backend = os.environ.get("RUNTIME_TTS_BACKEND", "disabled").lower()
    if backend == "disabled":
        return DisabledTtsAdapter()
    if backend == "deterministic":
        return DeterministicTtsAdapter(duration_ms=int(os.environ.get("RUNTIME_DETERMINISTIC_TTS_DURATION_MS", "240")))
    if backend == "qwen-loopback":
        if os.environ.get("RUNTIME_ASR_BACKEND", "fake").lower() == "qwen" and os.environ.get("RUNTIME_TTS_ASR_CORESIDENCY_VERIFIED", "false").lower() != "true":
            raise ValueError("qwen ASR plus qwen TTS remains disabled until target-host co-residency evidence passes")
        return LoopbackQwenTtsAdapter(os.environ.get("RUNTIME_TTS_ENDPOINT", "http://127.0.0.1:8770"))
    if backend == "kokoro-loopback":
        return LoopbackKokoroTtsAdapter(os.environ.get("RUNTIME_TTS_ENDPOINT", "http://127.0.0.1:8771"))
    raise ValueError(f"unsupported RUNTIME_TTS_BACKEND: {backend}")


def load_agent_manifest() -> list[dict[str, object]]:
    """Return stable logical roles; a role does not imply one resident model."""
    return AgentRegistry.default().public_manifest()


def get_orchestrator_id(manifest: list[dict[str, object]]) -> str:
    orchestrators = [str(agent["id"]) for agent in manifest if agent.get("isOrchestrator")]
    if len(orchestrators) != 1:
        raise RuntimeError(f"Manifest must contain exactly one orchestrator; received {len(orchestrators)}")
    return orchestrators[0]


async def handler(websocket) -> None:
    print(f"[Local Runtime] Client connected from {websocket.remote_address}")
    seq = 1
    session_id = "sess_001"
    target_agent_id: str | None = None
    protocol_version: int | None = None
    voice_session: VoiceSession | None = None
    registry = AgentRegistry.default()
    send_lock = asyncio.Lock()
    turn_tasks: set[asyncio.Task] = set()

    async def send_event(event: dict) -> None:
        nonlocal seq
        async with send_lock:
            event.setdefault("seq", seq)
            event.setdefault("sessionId", session_id)
            event.setdefault("timestamp", int(time.time() * 1000))
            seq += 1
            await websocket.send(json.dumps(event))

    async def send_binary(payload: bytes) -> None:
        async with send_lock:
            await websocket.send(payload)

    def start_turn(coroutine) -> None:
        async def guarded_turn() -> None:
            try:
                await coroutine
            except Exception:
                try:
                    await send_event({"type": "ERROR", "code": "TURN_FAILED", "message": "The turn failed safely; retry with text if needed.", "recoverable": True})
                except websockets.ConnectionClosed:
                    pass

        task = asyncio.create_task(guarded_turn())
        turn_tasks.add(task)
        task.add_done_callback(turn_tasks.discard)

    # First-release deployment keeps Hermes disabled because CLI one-shot mode
    # can auto-bypass tool approvals. The bounded adapter remains injectable at
    # this boundary after a separate read-only transport is audited.
    hermes = None
    orchestrator = LocalOrchestrator(
        send_event,
        emit_binary=send_binary,
        tts=create_tts(),
        response_chunk_delay_s=float(os.environ.get("RUNTIME_TTS_CHUNK_DELAY_MS", "0")) / 1000,
        registry=registry,
        supervisor=create_supervisor(registry),
        hermes=hermes,
    )

    async def emit_voice_event(event: dict) -> None:
        if event.get("type") == "USER_SPEECH_START":
            # Publish the authoritative VAD boundary first so clients can
            # measure boundary-to-stop latency against the following
            # response-scoped TTS_END(INTERRUPTED) marker.
            await send_event(event)
            if orchestrator.responses.is_active:
                await orchestrator.interrupt_response(f"vad-{event.get('turnId', seq)}")
            return
        await send_event(event)
        if event.get("type") == "STT_FINAL" and event.get("text"):
            start_turn(
                orchestrator.handle_turn(
                    session_id,
                    str(event.get("turnId")),
                    str(event.get("text")),
                    target_agent_id=target_agent_id,
                )
            )

    try:
        async for message in websocket:
            if isinstance(message, bytes):
                if protocol_version != 2:
                    await send_event({"type": "ERROR", "code": "UNSUPPORTED_PROTOCOL_CAPABILITY", "message": "Binary audio requires protocol version 2.", "recoverable": True})
                elif voice_session is None:
                    await send_event({"type": "ERROR", "code": "INVALID_AUDIO_FRAME", "message": "Binary audio requires an active CAPTURE_START.", "recoverable": True})
                else:
                    try:
                        voice_session.accept_audio(message)
                    except (InvalidAudioFrame, AudioBackpressure) as exc:
                        await send_event({"type": "ERROR", "code": "AUDIO_BACKPRESSURE" if isinstance(exc, AudioBackpressure) else "INVALID_AUDIO_FRAME", "message": str(exc), "recoverable": True})
                        if isinstance(exc, AudioBackpressure):
                            await voice_session.close()
                continue

            try:
                data = json.loads(message)
            except (json.JSONDecodeError, TypeError):
                await send_event({"type": "ERROR", "code": "INVALID_JSON", "message": "Client event must be valid JSON.", "recoverable": True})
                continue
            message_type = data.get("type")

            if message_type == "PING":
                await websocket.send(json.dumps({"type": "PONG", "timestamp": data.get("timestamp")}))
                continue

            if message_type == "CLIENT_HELLO":
                requested_version = data.get("protocolVersion")
                if requested_version not in (1, 2):
                    await send_event({"type": "ERROR", "code": "UNSUPPORTED_PROTOCOL_VERSION", "message": f"Supported protocol versions are 1 (text only) and 2; received {requested_version}.", "recoverable": False})
                    await websocket.close(code=4002, reason="Unsupported protocol version")
                    break
                protocol_version = requested_version
                session_id = str(data.get("sessionId", session_id))
                if requested_version == 2:
                    voice_session = VoiceSession(session_id, create_vad(), create_asr_adapter(), emit_voice_event)
                await send_event({"type": "AGENT_MANIFEST", "agents": registry.public_manifest()})
                await send_event({"type": "AGENT_STATE", "agentId": registry.orchestrator.id, "state": "idle"})
                continue

            if protocol_version is None:
                await send_event({"type": "ERROR", "code": "HANDSHAKE_REQUIRED", "message": "CLIENT_HELLO is required first.", "recoverable": True})
                continue

            if message_type == "CAPTURE_START":
                if protocol_version != 2 or voice_session is None:
                    await send_event({"type": "ERROR", "code": "UNSUPPORTED_PROTOCOL_CAPABILITY", "message": "CAPTURE_START requires protocol version 2.", "recoverable": True})
                else:
                    try:
                        await voice_session.start_capture(str(data.get("captureId", "")), data.get("format", {}))
                    except InvalidAudioFrame as exc:
                        await send_event({"type": "ERROR", "code": "INVALID_AUDIO_FRAME", "message": str(exc), "recoverable": True})
                continue

            if message_type == "CAPTURE_END":
                if protocol_version != 2 or voice_session is None:
                    await send_event({"type": "ERROR", "code": "UNSUPPORTED_PROTOCOL_CAPABILITY", "message": "CAPTURE_END requires protocol version 2.", "recoverable": True})
                else:
                    try:
                        await voice_session.end_capture(str(data.get("captureId", "")))
                    except InvalidAudioFrame as exc:
                        await send_event({"type": "ERROR", "code": "INVALID_AUDIO_FRAME", "message": str(exc), "recoverable": True})
                continue

            if message_type == "USER_TARGET":
                requested_target = data.get("targetAgentId")
                if requested_target == registry.orchestrator.id:
                    target_agent_id = None
                elif requested_target in registry.roles:
                    target_agent_id = str(requested_target)
                else:
                    target_agent_id = None
                    await send_event({"type": "ERROR", "code": "INVALID_AGENT_TARGET", "message": "Requested worker is not in the active manifest.", "recoverable": True})
                continue

            if message_type == "USER_TEXT":
                turn_id = str(data.get("turnId", f"turn_{int(time.time() * 1000)}"))
                user_text = str(data.get("text", "")).strip()
                if not user_text:
                    await send_event({"type": "ERROR", "code": "EMPTY_USER_TEXT", "message": "Text input cannot be empty.", "recoverable": True})
                    continue
                await send_event({"type": "STT_FINAL", "turnId": turn_id, "text": user_text})
                start_turn(orchestrator.handle_turn(session_id, turn_id, user_text, target_agent_id=target_agent_id))
                continue

            if message_type == "USER_INTERRUPT":
                await orchestrator.interrupt_response(str(data.get("commandId", f"interrupt-{seq}")))
                continue

            if message_type == "TASK_CANCEL":
                await orchestrator.cancel_task(str(data.get("taskId", "")), str(data.get("commandId", f"cancel-{seq}")))
                continue

    except websockets.ConnectionClosed:
        print(f"[Local Runtime] Client disconnected: {websocket.remote_address}")
    finally:
        orchestrator.responses.abandon()
        if voice_session is not None:
            await voice_session.close()


async def main() -> None:
    tts_probe = create_tts()
    if isinstance(tts_probe, LoopbackTtsAdapter):
        await tts_probe.healthcheck()
    asr_probe = create_asr_adapter()
    await asyncio.to_thread(asr_probe.warm)
    print(f"[Local Runtime] Starting WebSocket server on ws://127.0.0.1:{PORT} ...")
    async with websockets.serve(handler, "127.0.0.1", PORT):
        print(f"[Local Runtime] Running and listening on ws://127.0.0.1:{PORT}/ws")
        await asyncio.Future()


if __name__ == "__main__":
    asyncio.run(main())
