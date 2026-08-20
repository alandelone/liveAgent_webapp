# Lessons Learned & Historical Corrections

## Windows Console Emoji Encoding
- **Issue**: Python scripts printing raw Unicode emojis (e.g. `🚀`, `✅`) on Windows default CP936/GBK terminals throw `UnicodeEncodeError`.
- **Correction**: Avoid raw emojis in backend stdout logs or enforce UTF-8 streams to maintain cross-platform terminal compatibility.

## Real Voice Pipeline Separation
- **Issue**: Mock playback traces should remain strictly isolated to offline deterministic tests (`test-fixtures/seed-data.json`).
- **Correction**: Live runtime must always route actual user voice input to transcription and Hermes LLM execution rather than hardcoded mock turns.
