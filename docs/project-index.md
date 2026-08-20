# Project Index & Architecture Overview

## Overview
`livechat_agent` is a mobile-first, real-time voice-driven multi-agent interface that acts as the presentation and voice bus wrapper for the **Hermes** backend runtime.

## Core Documentation
- [`docs/product-vision.md`](product-vision.md): High-level product vision, core value propositions, and interaction paradigms.
- [`docs/mobile-web-real-time-multi-agent-voice-interface.md`](mobile-web-real-time-multi-agent-voice-interface.md): Comprehensive architectural specification, voice pipeline details, state machines, and event schemas.
- [`docs/api-contracts/hermes-protocol.md`](api-contracts/hermes-protocol.md): Real-time WebSocket event protocol between Web UI and Hermes.

## Repository Modules
- `docs/`: Product vision, architecture specs, and API contracts.
- `rules/`: Development standards, testing contracts, and linting guidelines.
- `stage-gates/`: Unidirectional task gate pipeline (01-Discovery -> 02-Design -> 03-Execution -> 04-Verification).
- `active-session/`: Live session runtime logs and agent handoff files.
- `repomemory/`: Architecture decisions, invariants, findings, and lessons learned.
- `test-fixtures/`: Deterministic test fixtures and seed data.
