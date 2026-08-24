# Findings & Troubleshooting Guide

> Sections below record v0.1 implementation findings. Under ADR-008, `server.py` is a legacy protocol/CLI bridge to migrate into the Local Runtime Service; it is not the target orchestrator.

## 1. Hermes Dashboard Server vs. Voice Event Protocol
- **Finding**: Running `hermes serve` launches Hermes's internal FastAPI web dashboard (intended for the desktop UI / REST APIs on port 9119). It does not provide the `AGENT_MANIFEST` / `CLIENT_HELLO` real-time WebSocket protocol required by `livechat_agent`.
- **Historical solution**: Implemented `server.py` (`npm run server`) as the v1 protocol bridge on port 8765, which interacts directly with Hermes CLI and profiles (`hermes -z` / `hermes --profile <name> -z`). The v0.2 target replaces its control-plane role with the Local Supervisor and retains Hermes behind an escalation adapter.

## 2. Real-Time Speech Recognition in Voice Controller
- **Finding**: Without native speech-to-text integration, speech audio events (`USER_SPEECH_START`/`USER_SPEECH_END`) required a server-side transcription model or resulted in static responses.
- **Historical solution**: Integrated browser-native Web Speech API (`SpeechRecognition`/`webkitSpeechRecognition`) alongside Web Audio RMS tracking and forwarded completed text as `USER_TEXT`.
- **Limitation**: This is a browser-dependent prototype, not zero-latency evidence and not the target PCM → server Silero VAD → Qwen3-ASR path. Browser language support, accuracy, network behavior, and timing vary by implementation.

## 3. Dynamic Hermes Profile Synchronization
- **Finding**: Sub-agents hardcoded in JSON fixtures do not reflect real Hermes profiles created in `C:\Users\Alandelone\AppData\Local\hermes\profiles`.
- **Solution**: `server.py` scans `C:\Users\Alandelone\AppData\Local\hermes\profiles` on connection and uses `subagents.config.json` to enforce limits (`max_visible_subagents`) and visual theme overrides.
