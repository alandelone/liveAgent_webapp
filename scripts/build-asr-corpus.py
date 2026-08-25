from __future__ import annotations

import argparse
import asyncio
from array import array
import hashlib
import json
from pathlib import Path
import sys
import wave

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from runtime.tts import LoopbackKokoroTtsAdapter, TtsRequest


OUTPUT = ROOT / "test-fixtures" / "v0.2" / "asr-corpus"
TARGET_RATE = 16_000
SCRIPT_VERSION = 1
CASES = (
    {"id": "asr-zh-command", "language": "zh", "text": "听我说", "keyTerms": ["听我说"], "expectedRoute": "command", "expectedCommand": "STOP_SPEAKING", "ttsLanguage": "Chinese", "speaker": "Vivian"},
    {"id": "asr-zh-status", "language": "zh", "text": "告诉我当前状态", "keyTerms": ["当前状态"], "expectedRoute": "command", "expectedCommand": "STATUS", "ttsLanguage": "Chinese", "speaker": "Vivian"},
    {"id": "asr-zh-research", "language": "zh", "text": "查看项目文档", "keyTerms": ["项目文档"], "expectedRoute": "research", "ttsLanguage": "Chinese", "speaker": "Vivian"},
    {"id": "asr-zh-coding", "language": "zh", "text": "修复类型错误", "keyTerms": ["类型错误"], "expectedRoute": "coding", "ttsLanguage": "Chinese", "speaker": "Vivian"},
    {"id": "asr-en-command", "language": "en", "text": "Stop speaking", "keyTerms": ["stop speaking"], "expectedRoute": "command", "expectedCommand": "STOP_SPEAKING", "ttsLanguage": "English", "speaker": "Ryan"},
    {"id": "asr-en-status", "language": "en", "text": "Tell me the current status", "keyTerms": ["current status"], "expectedRoute": "command", "expectedCommand": "STATUS", "ttsLanguage": "English", "speaker": "Ryan"},
    {"id": "asr-en-research", "language": "en", "text": "Review the architecture docs", "keyTerms": ["architecture"], "expectedRoute": "research", "ttsLanguage": "English", "speaker": "Ryan"},
    {"id": "asr-en-coding", "language": "en", "text": "Fix the TypeScript error", "keyTerms": ["TypeScript"], "expectedRoute": "coding", "ttsLanguage": "English", "speaker": "Ryan"},
    {"id": "asr-mix-research", "language": "code-switch", "text": "帮我 review the API docs", "keyTerms": ["review", "API"], "expectedRoute": "research", "ttsLanguage": "Chinese", "speaker": "Vivian"},
    {"id": "asr-mix-coding", "language": "code-switch", "text": "把这个 TypeScript bug fix 掉", "keyTerms": ["TypeScript", "bug", "fix"], "expectedRoute": "coding", "ttsLanguage": "Chinese", "speaker": "Vivian"},
    {"id": "asr-mix-browser", "language": "code-switch", "text": "open 一下 localhost dashboard", "keyTerms": ["localhost", "dashboard"], "expectedRoute": "browser", "ttsLanguage": "Chinese", "speaker": "Vivian"},
    {"id": "asr-mix-status", "language": "code-switch", "text": "告诉我 current status", "keyTerms": ["current status"], "expectedRoute": "command", "expectedCommand": "STATUS", "ttsLanguage": "Chinese", "speaker": "Vivian"},
)


def resample(samples: tuple[float, ...], source_rate: int) -> array:
    if source_rate <= 0 or not samples:
        raise ValueError("source audio is empty or has an invalid sample rate")
    target_length = round(len(samples) * TARGET_RATE / source_rate)
    result = array("h")
    for index in range(target_length):
        source_position = index * source_rate / TARGET_RATE
        left = min(len(samples) - 1, int(source_position))
        right = min(len(samples) - 1, left + 1)
        fraction = source_position - left
        value = samples[left] + (samples[right] - samples[left]) * fraction
        result.append(round(max(-1.0, min(1.0, value)) * 32767))
    return result


def write_wav(path: Path, samples: array) -> None:
    leading = array("h", [0]) * (TARGET_RATE * 2 // 5)
    trailing = array("h", [0]) * (TARGET_RATE * 4 // 5)
    payload = leading + samples + trailing
    with wave.open(str(path), "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(TARGET_RATE)
        output.writeframes(payload.tobytes())


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def validate_manifest() -> dict:
    manifest_path = OUTPUT / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest.get("schemaVersion") != 1 or len(manifest.get("cases", [])) != len(CASES):
        raise ValueError("ASR corpus manifest schema or case count is invalid")
    for item in manifest["cases"]:
        path = OUTPUT / item["path"]
        if not path.is_file() or sha256(path) != item["sha256"]:
            raise ValueError(f"ASR corpus hash mismatch: {item['id']}")
        with wave.open(str(path), "rb") as source:
            if (source.getframerate(), source.getnchannels(), source.getsampwidth()) != (TARGET_RATE, 1, 2):
                raise ValueError(f"ASR corpus format mismatch: {item['id']}")
            if source.getnframes() != item["frames"]:
                raise ValueError(f"ASR corpus frame count mismatch: {item['id']}")
    return manifest


async def build(endpoint: str) -> dict:
    adapter = LoopbackKokoroTtsAdapter(endpoint, timeout_s=60)
    health = await adapter.healthcheck()
    OUTPUT.mkdir(parents=True, exist_ok=True)
    records = []
    for case in CASES:
        audio = await adapter.synthesize(
            TtsRequest(
                turn_id=f"corpus-{case['id']}",
                stream_id=f"corpus-{case['id']}",
                text=case["text"],
                language=case["ttsLanguage"],
                speaker=case["speaker"],
                deadline_ms=15_000,
            )
        )
        audio.validate()
        path = OUTPUT / f"{case['id']}.wav"
        write_wav(path, resample(audio.samples, audio.sample_rate_hz))
        with wave.open(str(path), "rb") as source:
            frames = source.getnframes()
        records.append({
            **{key: value for key, value in case.items() if key not in {"ttsLanguage", "speaker"}},
            "path": path.name,
            "sha256": sha256(path),
            "frames": frames,
            "durationMs": round(frames / TARGET_RATE * 1000, 3),
            "ttsLanguage": case["ttsLanguage"],
            "speaker": case["speaker"],
        })
    manifest = {
        "schemaVersion": 1,
        "scriptVersion": SCRIPT_VERSION,
        "sampleRateHz": TARGET_RATE,
        "encoding": "pcm_s16le",
        "source": {
            "backend": "kokoro-loopback",
            "model": health.get("model"),
            "revision": adapter.model_revision,
            "limitation": "fixed selected-TTS regression speech; not population-level human accuracy",
        },
        "cases": records,
    }
    (OUTPUT / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return validate_manifest()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--endpoint")
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    try:
        if args.check:
            manifest = validate_manifest()
        else:
            if not args.endpoint:
                raise ValueError("--endpoint is required when building the corpus")
            manifest = asyncio.run(build(args.endpoint))
    except Exception as exc:
        print(json.dumps({"status": "fail", "errorType": type(exc).__name__, "message": str(exc)}, ensure_ascii=False))
        return 1
    print(json.dumps({"status": "pass", "cases": len(manifest["cases"]), "manifest": str(OUTPUT / "manifest.json")}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
