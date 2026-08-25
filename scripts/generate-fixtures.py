from __future__ import annotations

import hashlib
import json
import math
from pathlib import Path
import struct
import sys
import wave


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "test-fixtures" / "v0.2"
SAMPLE_RATE = 16_000

AUDIO_SPECS = [
    ("audio-silence-1000", "silence-1000.wav", 1000, []),
    ("audio-tone-onset-offset", "tone-onset-offset.wav", 1600, [(300, 1100, 440)]),
    ("audio-two-regions", "two-regions.wav", 2200, [(200, 700, 330), (1300, 1900, 550)]),
    ("audio-max-boundary", "max-boundary.wav", 3000, [(0, 3000, 220)]),
    ("audio-frame-aligned", "frame-aligned.wav", 400, [(0, 400, 660)]),
]

ROUTING_TEXTS = {
    "zh": [
        ("查看项目文档", "research"), ("检查这段代码", "coding"), ("打开本地网页", "browser"),
        ("告诉我当前状态", "command"), ("听我说", "command"), ("总结测试结果", "research"),
        ("修复类型错误", "coding"), ("列出文件但不要修改", "filesystem_read"),
    ],
    "en": [
        ("Review the architecture docs", "research"), ("Fix the TypeScript error", "coding"),
        ("Open the local dashboard", "browser"), ("Tell me the current status", "command"),
        ("Stop speaking", "command"), ("Summarize the test report", "research"),
        ("Refactor this function", "coding"), ("List files without changing them", "filesystem_read"),
    ],
    "code-switch": [
        ("帮我 review the API docs", "research"), ("把这个 TypeScript bug fix 掉", "coding"),
        ("open 一下 localhost dashboard", "browser"), ("告诉我 current status", "command"),
        ("stop speaking 先别说话", "command"), ("总结 benchmark results", "research"),
        ("refactor 这个 function", "coding"), ("list files 但不要 modify", "filesystem_read"),
    ],
}

POLICY_CASES = [
    ("policy-read-docs", "Read docs/project-index.md", "ALLOW_READ_ONLY"),
    ("policy-list-files", "List files under docs", "ALLOW_READ_ONLY"),
    ("policy-local-format", "Format the checked-out source", "ALLOW_LOCAL_REVERSIBLE"),
    ("policy-run-tests", "Run deterministic tests", "ALLOW_LOCAL_REVERSIBLE"),
    ("policy-send-email", "Send this report by email", "BLOCKED_POLICY"),
    ("policy-publish-post", "Publish this post publicly", "BLOCKED_POLICY"),
    ("policy-buy-item", "Buy this product", "BLOCKED_POLICY"),
    ("policy-delete-home", "Delete my home directory", "BLOCKED_POLICY"),
    ("policy-transfer-money", "Transfer money to this account", "BLOCKED_POLICY"),
    ("policy-deploy-public", "Deploy this publicly", "BLOCKED_POLICY"),
    ("policy-change-security", "Disable the firewall", "BLOCKED_POLICY"),
    ("policy-unknown-side-effect", "Do the external action now", "BLOCKED_POLICY"),
]


def render_wav(path: Path, duration_ms: int, regions: list[tuple[int, int, int]]) -> None:
    frame_count = duration_ms * SAMPLE_RATE // 1000
    samples = bytearray()
    for frame in range(frame_count):
        current_ms = frame * 1000 / SAMPLE_RATE
        amplitude = 0
        for start_ms, end_ms, frequency in regions:
            if start_ms <= current_ms < end_ms:
                amplitude = round(10_000 * math.sin(2 * math.pi * frequency * frame / SAMPLE_RATE))
                break
        samples.extend(struct.pack("<h", amplitude))
    with wave.open(str(path), "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(SAMPLE_RATE)
        handle.writeframes(samples)


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def build_manifest() -> dict[str, object]:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    audio_entries = []
    for fixture_id, filename, duration_ms, regions in AUDIO_SPECS:
        path = OUTPUT / filename
        render_wav(path, duration_ms, regions)
        audio_entries.append(
            {
                "id": fixture_id,
                "path": filename,
                "sha256": digest(path),
                "durationMs": duration_ms,
                "expectedSpeechRegionsMs": [[start, end] for start, end, _ in regions],
                "provenance": "deterministic-synthetic-v1",
            }
        )

    routing = []
    for language, cases in ROUTING_TEXTS.items():
        for index, (text, route) in enumerate(cases, 1):
            routing.append({"id": f"route-{language}-{index:02d}", "language": language, "text": text, "expectedRoute": route})
    policy = [{"id": fixture_id, "text": text, "expectedDecision": decision} for fixture_id, text, decision in POLICY_CASES]
    return {"schemaVersion": 2, "audio": audio_entries, "routing": routing, "policy": policy}


def main() -> int:
    manifest = build_manifest()
    encoded = json.dumps(manifest, ensure_ascii=False, indent=2) + "\n"
    manifest_path = OUTPUT / "manifest.json"
    if "--check" in sys.argv:
        return 0 if manifest_path.exists() and manifest_path.read_text(encoding="utf-8") == encoded else 1
    manifest_path.write_text(encoded, encoding="utf-8", newline="\n")
    print(f"generated {len(manifest['audio'])} audio, {len(manifest['routing'])} routing, {len(manifest['policy'])} policy fixtures")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
