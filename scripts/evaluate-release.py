from __future__ import annotations

import argparse
import asyncio
from dataclasses import asdict
import json
from pathlib import Path
import subprocess
import sys
import time
import wave

from websockets.sync.client import connect


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from runtime.evaluation import evaluate_release_thresholds, score_asr_case, summarize_asr, summarize_latencies
from runtime.orchestrator import LocalOrchestrator
from runtime.policy import CommandRecognizer, ExecutionPolicy
from runtime.supervisor import DeterministicSupervisor
from runtime.tts import DisabledTtsAdapter


CORPUS = ROOT / "test-fixtures" / "v0.2" / "asr-corpus"
FIXTURES = ROOT / "test-fixtures" / "v0.2" / "manifest.json"
DEFAULT_OUTPUT = ROOT / "deployment" / "release-evidence.json"


def gpu_snapshot() -> dict[str, object]:
    command = [
        "nvidia-smi",
        "--query-gpu=memory.used,memory.free,temperature.gpu,power.draw",
        "--format=csv,noheader,nounits",
    ]
    try:
        values = subprocess.check_output(command, text=True, timeout=10).strip().split(", ")
        processes = subprocess.check_output(
            ["nvidia-smi", "--query-compute-apps=pid", "--format=csv,noheader,nounits"],
            text=True,
            timeout=10,
        ).splitlines()
        engine_output = subprocess.check_output(
            ["wsl", "-d", "Debian", "--", "bash", "-lc", "ps -eo pid=,args= | grep 'VLLM::EngineCore' | grep -v grep || true"],
            text=True,
            timeout=10,
        )
        engine_pids = [line.strip().split(maxsplit=1)[0] for line in engine_output.splitlines() if line.strip()]
        return {
            "memoryUsedMiB": int(values[0]),
            "memoryFreeMiB": int(values[1]),
            "temperatureC": int(values[2]),
            "powerW": float(values[3]),
            "computePids": sorted({line.strip() for line in processes if line.strip()}),
            "asrEnginePids": engine_pids,
        }
    except Exception as exc:
        return {"error": f"{type(exc).__name__}: {exc}"}


async def classify(text: str) -> tuple[str | None, str]:
    command = CommandRecognizer().recognize(text)
    decision = await DeterministicSupervisor().route(text)
    return command.value if command else None, decision.route


def receive_json(websocket, timeout: float) -> tuple[dict | None, bool]:
    message = websocket.recv(timeout=timeout)
    if isinstance(message, bytes):
        return None, True
    return json.loads(message), False


def run_voice_case(url: str, case: dict) -> dict[str, object]:
    capture_id = f"release-{case['id']}"
    session_id = f"release-{case['id']}"
    events: list[dict] = []
    binary_chunks = 0
    first_audio_at: float | None = None
    speech_end_at: float | None = None
    started = time.monotonic()
    with connect(url, open_timeout=10, close_timeout=5) as websocket:
        websocket.send(json.dumps({"type": "CLIENT_HELLO", "protocolVersion": 2, "sessionId": session_id, "lastSeq": None}))
        for _ in range(2):
            event, _ = receive_json(websocket, 10)
            if event:
                events.append(event)
        websocket.send(json.dumps({
            "type": "CAPTURE_START",
            "sessionId": session_id,
            "captureId": capture_id,
            "format": {"encoding": "pcm_s16le", "sampleRateHz": 16000, "channels": 1, "frameMs": 20},
        }))
        with wave.open(str(CORPUS / case["path"]), "rb") as source:
            while payload := source.readframes(320):
                websocket.send(payload.ljust(640, b"\0"))
                time.sleep(0.02)
        websocket.send(json.dumps({"type": "CAPTURE_END", "sessionId": session_id, "captureId": capture_id}))

        deadline = time.monotonic() + 180
        while time.monotonic() < deadline:
            event, binary = receive_json(websocket, min(10, max(0.1, deadline - time.monotonic())))
            now = time.monotonic()
            if binary:
                binary_chunks += 1
                first_audio_at = first_audio_at or time.time()
                continue
            if event is None:
                continue
            events.append(event)
            if event.get("type") == "USER_SPEECH_END":
                speech_end_at = float(event.get("timestamp", time.time() * 1000)) / 1000
            types = [item.get("type") for item in events]
            is_stop = case.get("expectedCommand") == "STOP_SPEAKING"
            if is_stop and "COMMAND_ACK" in types:
                break
            if "TTS_END" in types and any(item.get("type") == "AGENT_STATE" and item.get("state") == "idle" for item in events[types.index("TTS_END"):]):
                break
        else:
            raise TimeoutError(f"voice case did not reach a terminal outcome: {case['id']}")

    final = next((item for item in events if item.get("type") == "STT_FINAL"), {})
    hypothesis = str(final.get("text", ""))
    actual_command, actual_route = asyncio.run(classify(hypothesis))
    errors = [item for item in events if item.get("type") == "ERROR"]
    if case.get("expectedCommand") == "STOP_SPEAKING":
        terminal = any(item.get("type") == "COMMAND_ACK" and item.get("outcome") in {"ACCEPTED", "ALREADY_APPLIED"} for item in events)
    else:
        terminal = any(item.get("type") == "TTS_END" and item.get("outcome") == "COMPLETED" for item in events)
    score = score_asr_case(
        case_id=case["id"],
        language=case["language"],
        reference=case["text"],
        hypothesis=hypothesis,
        key_terms=case.get("keyTerms", []),
        expected_command=case.get("expectedCommand"),
        actual_command=actual_command,
        expected_route=case.get("expectedRoute"),
        actual_route=actual_route,
        terminal_correct=terminal and not errors,
    )
    return {
        "score": asdict(score),
        "eventTypes": [item.get("type") for item in events],
        "binaryChunks": binary_chunks,
        "firstAudioMs": None if first_audio_at is None or speech_end_at is None else round((first_audio_at - speech_end_at) * 1000, 3),
        "elapsedMs": round((time.monotonic() - started) * 1000, 3),
        "errors": errors,
    }


def deterministic_fixture_checks() -> dict[str, object]:
    fixtures = json.loads(FIXTURES.read_text(encoding="utf-8"))
    supervisor = DeterministicSupervisor()
    route_results = []
    for item in fixtures["routing"]:
        actual = asyncio.run(supervisor.route(item["text"])).route
        route_results.append({"id": item["id"], "expected": item["expectedRoute"], "actual": actual, "passes": actual == item["expectedRoute"]})
    policy = ExecutionPolicy()
    policy_results = []
    for item in fixtures["policy"]:
        actual = policy.classify_fixture(item["text"]).decision.value
        policy_results.append({"id": item["id"], "expected": item["expectedDecision"], "actual": actual, "passes": actual == item["expectedDecision"]})
    return {
        "routes": route_results,
        "policies": policy_results,
        "routesPass": all(item["passes"] for item in route_results),
        "policiesPass": all(item["passes"] for item in policy_results),
    }


async def deterministic_soak() -> dict[str, object]:
    outcomes = []
    events: list[dict] = []

    async def emit(event: dict) -> None:
        events.append(event)

    orchestrator = LocalOrchestrator(emit, tts=DisabledTtsAdapter())
    prompts = ("Review the architecture docs", "Fix the TypeScript error", "Open the local dashboard", "Tell me the current status")
    for index in range(100):
        events.clear()
        result = await orchestrator.handle_turn("deterministic-soak", f"soak-{index:03d}", prompts[index % len(prompts)])
        legal = result.state in {"COMPLETED", "BLOCKED_POLICY"} and not any(item.get("type") == "ERROR" for item in events)
        outcomes.append({"turnId": f"soak-{index:03d}", "state": result.state, "legal": legal})
    return {"turns": len(outcomes), "legalTerminals": sum(item["legal"] for item in outcomes), "passes": all(item["legal"] for item in outcomes)}


def production_text_sample(url: str) -> dict[str, object]:
    prompts = ("听我说", "Stop speaking", "status", "Tell me the current status", "continue", "repeat", "Review the architecture docs", "Fix the TypeScript error")
    results = []
    with connect(url, open_timeout=10, close_timeout=5) as websocket:
        websocket.send(json.dumps({"type": "CLIENT_HELLO", "protocolVersion": 1, "sessionId": "release-text-sample"}))
        receive_json(websocket, 10)
        receive_json(websocket, 10)
        for index, prompt in enumerate(prompts):
            turn_id = f"release-text-{index}"
            websocket.send(json.dumps({"type": "USER_TEXT", "turnId": turn_id, "text": prompt}))
            events = []
            deadline = time.monotonic() + 60
            while time.monotonic() < deadline:
                event, binary = receive_json(websocket, min(10, max(0.1, deadline - time.monotonic())))
                if binary or event is None:
                    continue
                events.append(event)
                if any(item.get("type") == "COMMAND_ACK" for item in events):
                    break
                if any(item.get("type") == "TTS_END" for item in events) and event.get("type") == "AGENT_STATE" and event.get("state") == "idle":
                    break
            legal = not any(item.get("type") == "ERROR" for item in events) and (
                any(item.get("type") == "COMMAND_ACK" for item in events)
                or any(item.get("type") == "TTS_END" and item.get("outcome") == "COMPLETED" for item in events)
            )
            results.append({"turnId": turn_id, "text": prompt, "legalTerminal": legal, "eventTypes": [item.get("type") for item in events]})
    return {"turns": len(results), "legalTerminals": sum(item["legalTerminal"] for item in results), "passes": all(item["legalTerminal"] for item in results), "results": results}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="ws://127.0.0.1:8765/ws")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    corpus = json.loads((CORPUS / "manifest.json").read_text(encoding="utf-8"))
    before = gpu_snapshot()
    cases = []
    try:
        for item in corpus["cases"]:
            result = run_voice_case(args.url, item)
            cases.append(result)
            print(json.dumps({"case": item["id"], "hypothesis": result["score"]["hypothesis"], "errorRate": result["score"]["error_rate"], "terminal": result["score"]["terminal_correct"]}, ensure_ascii=False), flush=True)
    except Exception as exc:
        print(json.dumps({"status": "fail", "errorType": type(exc).__name__, "message": str(exc)}, ensure_ascii=False))
        return 1
    scores = [score_asr_case(**{
        "case_id": item["score"]["case_id"], "language": item["score"]["language"],
        "reference": item["score"]["reference"], "hypothesis": item["score"]["hypothesis"],
        "key_terms": next(case.get("keyTerms", []) for case in corpus["cases"] if case["id"] == item["score"]["case_id"]),
        "expected_command": next((case.get("expectedCommand") for case in corpus["cases"] if case["id"] == item["score"]["case_id"]), None),
        "actual_command": asyncio.run(classify(item["score"]["hypothesis"]))[0],
        "expected_route": next((case.get("expectedRoute") for case in corpus["cases"] if case["id"] == item["score"]["case_id"]), None),
        "actual_route": asyncio.run(classify(item["score"]["hypothesis"]))[1],
        "terminal_correct": item["score"]["terminal_correct"],
    }) for item in cases]
    summary = summarize_asr(scores)
    thresholds = evaluate_release_thresholds(summary)
    fixtures = deterministic_fixture_checks()
    soak = asyncio.run(deterministic_soak())
    production_text = production_text_sample(args.url)
    audio_latencies = [item["firstAudioMs"] for item in cases if item["firstAudioMs"] is not None]
    latency = summarize_latencies(audio_latencies) if audio_latencies else None
    latency_pass = bool(latency and latency["p50Ms"] <= 3000 and latency["p95Ms"] <= 8000)
    after = gpu_snapshot()
    gpu_pass = "error" not in after and after["memoryUsedMiB"] <= 8192 and after["memoryFreeMiB"] >= 3584 and after["temperatureC"] < 85 and len(after["asrEnginePids"]) == 1
    production_terminal_pass = len(cases) + production_text["turns"] >= 20 and all(item["score"]["terminal_correct"] for item in cases) and production_text["passes"]
    passes = thresholds["passes"] and fixtures["routesPass"] and fixtures["policiesPass"] and latency_pass and gpu_pass and soak["passes"] and production_terminal_pass
    evidence = {
        "schemaVersion": 1,
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "status": "pass" if passes else "fail",
        "corpus": corpus["source"],
        "asr": summary,
        "thresholds": thresholds,
        "latency": latency,
        "latencyPass": latency_pass,
        "fixtures": fixtures,
        "deterministicSoak": soak,
        "productionTerminals": {"voiceTurns": len(cases), "text": production_text, "passes": production_terminal_pass},
        "gpu": {"before": before, "after": after, "passes": gpu_pass},
        "cases": cases,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(evidence, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"status": evidence["status"], "output": str(args.output), "asr": summary, "latency": latency, "gpu": evidence["gpu"]}, ensure_ascii=False))
    return 0 if passes else 1


if __name__ == "__main__":
    raise SystemExit(main())
