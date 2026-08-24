# Project Context & Invariants

## Product Identity

`livechat_agent` is a **local-first real-time voice agent system** with two runtime boundaries: a browser Web UI and a backend Local Runtime Service. The Local Supervisor is the primary orchestrator. Hermes is an optional heavy-reasoning or escalation worker, not the global controller.

Full vision: [`docs/product-vision.md`](../docs/product-vision.md). Target voice design: [`docs/liveagent_voice_pipeline_design.md`](../docs/liveagent_voice_pipeline_design.md). Interaction specification: [`docs/mobile-web-real-time-multi-agent-voice-interface.md`](../docs/mobile-web-real-time-multi-agent-voice-interface.md).

## Architecture: User ↔ Web UI ↔ Local Runtime

```text
┌─────────────────────────────────────────────┐
│                BROWSER WEB UI               │
│ getUserMedia · AEC/NS/AGC · AudioWorklet   │
│ Spatial Voice Room · Transcript · Summaries │
└────────────────────┬────────────────────────┘
                     │ WebSocket: PCM + public events
                     ▼
┌─────────────────────────────────────────────┐
│            LOCAL RUNTIME SERVICE            │
│ Silero VAD · Qwen3-ASR · Local Supervisor  │
│ Scheduler · Policy · Trace · TTS            │
└───────────────┬───────────────────┬─────────┘
                │                   │ escalation only
                ▼                   ▼
       Specialized worker pool    Hermes
```

This is a logical ownership boundary. Native Windows, WSL2, container, and split-process packaging remain deployment decisions until measured in Phase 2.

## System Invariants (Non-Negotiable)

1. **The Local Supervisor is the primary orchestrator.**
   - The Local Runtime owns intent classification, routing, scheduling, task/job state, policy enforcement, cancellation, retries, response coordination, and Hermes escalation.

2. **The browser never orchestrates or executes agent work.**
   - Direct Agent Mode sends a target preference to the Local Runtime. The Supervisor validates and routes it; the browser cannot bypass runtime policy.

3. **Local Runtime events are authoritative.**
   - The UI may predict presentation-only transitions for immediacy, then reconciles with runtime events. It must not infer hidden Supervisor or worker activity.

4. **Barge-in and task cancellation are separate semantics.**
   - `USER_INTERRUPT` stops the current response/TTS turn. `TASK_CANCEL` targets a task and propagates only to cancellable descendants. Background work is not cancelled merely because the user speaks.

5. **Audio never blocks the UI thread.**
   - Capture/playback processing belongs off the main thread, with bounded queues and throttled high-frequency telemetry.

6. **Acoustic echo control is mandatory on the supported voice path.**
   - Request browser AEC/NS/AGC, verify applied settings, test real devices, and retain push-to-talk/headset fallback. Requested constraints are not assumed effective.

7. **Agent identity is manifest-driven.**
   - The `isOrchestrator` manifest flag selects the center orb. No production logic may require the orchestrator ID to be `hermes`; Hermes appears only while active as a worker/escalation target.

8. **The Web UI receives public summaries, not the internal routing graph.**
   - Internal logs retain canonical trace/job relationships for debugging and performance review. UI task views remain read-only projections.

9. **First-audio latency is the primary interaction KPI.**
   - Measure the full `speech_end → first audible response` path and its components; do not infer it from simulated timers or average latency alone.

10. **The first release has no approval workflow.**
    - Only read-only and explicitly allowlisted local reversible actions may execute. Externally visible, paid, irreversible, or high-impact actions return `BLOCKED_POLICY`. `WAITING_APPROVAL` is deferred.
