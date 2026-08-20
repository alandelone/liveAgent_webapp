# Findings & Troubleshooting Guide

## 1. Hermes Dashboard Server vs. Voice Event Protocol
- **Finding**: Running `hermes serve` launches Hermes's internal FastAPI web dashboard (intended for the desktop UI / REST APIs on port 9119). It does not provide the `AGENT_MANIFEST` / `CLIENT_HELLO` real-time WebSocket protocol required by `livechat_agent`.
- **Solution**: Implemented `server.py` (`npm run server`) as the dedicated real-time voice protocol bridge on port 8765, which interacts directly with Hermes CLI and profiles (`hermes -z` / `hermes --profile <name> -z`).

## 2. Real-Time Speech Recognition in Voice Controller
- **Finding**: Without native speech-to-text integration, speech audio events (`USER_SPEECH_START`/`USER_SPEECH_END`) required a server-side transcription model or resulted in static responses.
- **Solution**: Integrated the browser-native Web Speech API (`webkitSpeechRecognition`) into `src/audio/voiceController.ts` alongside Web Audio RMS amplitude tracking. It transcribes Chinese and English speech in real-time with zero latency and automatically sends exact `USER_TEXT` upon speech completion.

## 3. Dynamic Hermes Profile Synchronization
- **Finding**: Sub-agents hardcoded in JSON fixtures do not reflect real Hermes profiles created in `C:\Users\Alandelone\AppData\Local\hermes\profiles`.
- **Solution**: `server.py` scans `C:\Users\Alandelone\AppData\Local\hermes\profiles` on connection and uses `subagents.config.json` to enforce limits (`max_visible_subagents`) and visual theme overrides.
