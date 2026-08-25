# Project Index & Architecture Overview

## Overview
`livechat_agent` is a local-first, mobile-first voice agent system. A browser Web UI handles microphone capture, playback, and public visualization; a backend Local Runtime runs server VAD/ASR, the primary local Supervisor, agent scheduling, policy, tracing, TTS, and selective Hermes escalation.

## Core Documentation
- [`docs/product-vision.md`](product-vision.md): High-level product vision, core value propositions, and interaction paradigms.
- [`docs/mobile-web-real-time-multi-agent-voice-interface.md`](mobile-web-real-time-multi-agent-voice-interface.md): Comprehensive architectural specification, voice pipeline details, state machines, and event schemas.
- [`docs/liveagent_voice_pipeline_design.md`](liveagent_voice_pipeline_design.md): Local-first Web App microphone, VAD, streaming ASR, Supervisor, cancellation, and benchmark upgrade design.
- [`docs/api-contracts/hermes-protocol.md`](api-contracts/hermes-protocol.md): Web UI ↔ Local Runtime real-time protocol. The filename and environment variable retain legacy Hermes naming during the versioned migration.

## Repository Modules
- `docs/`: Product vision, architecture specs, and API contracts.
- `runtime/`: Trace/logging/benchmark primitives plus bounded PCM ingress, VAD/ASR adapters, transcript stabilization, deterministic policy, Supervisor/scheduler/Hermes boundaries, TTS adapters, and revisioned response coordination.
- `src/audio/`: Browser AudioWorklet lifecycle, stateful resampling/framing, bounded PCM uplink, playback, echo, and interruption controllers.
- `public/audio-capture-worklet.js`: Off-main-thread mono PCM capture and exact 20 ms framing.
- `public/audio-playback-worklet.js`: Off-main-thread bounded float32 PCM ring-buffer rendering, drain, RMS, underrun, overrun, and generation-stop handling.
- `scripts/`: Reproducible Node/WSL bootstrap, preflight, fixture generation, gateway smoke, and GPU/Silero/model-adapter smoke commands.
- `deployment/`: Supported localhost deployment and rollback runbook.
- `rules/`: Development standards, testing contracts, and linting guidelines.
- `stage-gates/`: Unidirectional task gate pipeline (01-Discovery -> 02-Design -> 03-Execution -> 04-Verification).
- `active-session/`: Live session runtime logs and agent handoff files.
- `repomemory/`: Architecture decisions, invariants, findings, and lessons learned.
- `test-fixtures/`: Deterministic test fixtures and seed data.
