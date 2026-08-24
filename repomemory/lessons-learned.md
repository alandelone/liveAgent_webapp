# Lessons Learned & Historical Corrections

## Windows Console Emoji Encoding
- **Issue**: Python scripts printing raw Unicode emojis (e.g. `🚀`, `✅`) on Windows default CP936/GBK terminals throw `UnicodeEncodeError`.
- **Correction**: Avoid raw emojis in backend stdout logs or enforce UTF-8 streams to maintain cross-platform terminal compatibility.

## Real Voice Pipeline Separation
- **Issue**: Mock playback traces should remain strictly isolated to offline deterministic tests (`test-fixtures/seed-data.json`).
- **Correction**: Live acceptance must route actual Web App microphone PCM through the selected transcription path and Local Supervisor. Hermes is used only when the Supervisor explicitly escalates. Hardcoded mock turns and simulated playback remain test-only.
