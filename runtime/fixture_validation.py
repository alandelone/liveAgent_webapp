from __future__ import annotations

import hashlib
import json
from pathlib import Path
import wave
from typing import Any


class FixtureValidationError(ValueError):
    pass


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(64 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_and_validate_manifest(path: Path) -> dict[str, Any]:
    manifest = json.loads(path.read_text(encoding="utf-8"))
    if manifest.get("schemaVersion") != 2:
        raise FixtureValidationError("fixture schemaVersion must be 2")

    groups = ("audio", "routing", "policy")
    ids: set[str] = set()
    for group in groups:
        entries = manifest.get(group)
        if not isinstance(entries, list) or not entries:
            raise FixtureValidationError(f"fixture group {group} must be a non-empty list")
        for entry in entries:
            fixture_id = entry.get("id")
            if not isinstance(fixture_id, str) or not fixture_id:
                raise FixtureValidationError(f"fixture in {group} has no stable id")
            if fixture_id in ids:
                raise FixtureValidationError(f"duplicate fixture id: {fixture_id}")
            ids.add(fixture_id)

    languages = {entry.get("language") for entry in manifest["routing"]}
    if languages != {"zh", "en", "code-switch"}:
        raise FixtureValidationError("routing fixtures must cover zh, en, and code-switch")
    if len(manifest["routing"]) < 24 or len(manifest["policy"]) < 12:
        raise FixtureValidationError("fixture sample-size floor is not met")

    base = path.parent
    for entry in manifest["audio"]:
        audio_path = base / entry["path"]
        if not audio_path.is_file():
            raise FixtureValidationError(f"missing audio fixture: {audio_path}")
        if sha256_file(audio_path) != entry.get("sha256"):
            raise FixtureValidationError(f"audio hash mismatch: {entry['id']}")
        with wave.open(str(audio_path), "rb") as audio:
            properties = (audio.getnchannels(), audio.getsampwidth(), audio.getframerate())
            if properties != (1, 2, 16_000):
                raise FixtureValidationError(f"invalid PCM format for {entry['id']}: {properties}")
            duration_ms = round(audio.getnframes() / audio.getframerate() * 1000)
            if duration_ms != entry.get("durationMs"):
                raise FixtureValidationError(f"duration mismatch for {entry['id']}")
    return manifest

