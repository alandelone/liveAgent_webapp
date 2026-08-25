# LiveAgent Voice Pipeline Upgrade

**Design baseline for RTX 4070 Ti 12GB**

**Status:** FEAT-014 through FEAT-026 verified; full-duplex TTS/playback implementation and hardware verification in progress
**Primary goals:** low latency, operational stability, cost sensitivity, and natural Chinese-English code-switching

## 1. Executive decision

Use a local-first streaming voice pipeline:

> Web App microphone (`getUserMedia`) -> browser audio front end (AEC/NS/AGC + AudioWorklet framing) -> WebSocket PCM stream -> Silero VAD -> Qwen3-ASR 1.7B -> Transcript Stabilizer -> Qwen3 1.7B Supervisor/Orchestrator -> specialized worker roles and Hermes API when needed -> Response Coordinator -> real streaming TTS and browser playback layer

The **Qwen3-ASR family is selected**, with **Qwen3-ASR 1.7B as the initial test choice**. The first local Supervisor to test is **Qwen3 1.7B**. Escalation to a larger or quantized Supervisor is conditional: it should happen only if benchmarked routing quality is inadequate, not simply to consume more GPU.

The system should maintain VRAM and compute headroom for overlapping ASR, routing, buffering, and voice output. GPU utilization is an observed constraint, not the objective.

### 1.1 Verified current state

The primary browser path now captures framed PCM through AudioWorklet, the Runtime runs bounded ingestion plus authoritative VAD/ASR, and all final text enters the deterministic-policy/Local-Supervisor/scheduler boundary. FEAT-014 through FEAT-026 have evaluator proof. The Phase 6 implementation adds strict correlated TTS markers, real downstream float32 PCM, a revisioned Response Coordinator, and AudioWorklet ring-buffer playback; its live Qwen TTS, audible-browser, and acoustic evidence must pass before FEAT-027 through FEAT-029 are marked complete.

The selected official TTS candidate is `Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice` revision `85e237c12c027371202489a0ec509ded67b5e4b5`. Its current high-level API generates complete waveforms even when its simulated streaming-input flag is used, so the initial integration synthesizes bounded clauses and then streams PCM. This distinction is deliberate and testable.

## 2. Goals and non-goals

### Goals

- Respond quickly enough for conversational turn-taking, including interruption and cancellation.
- Produce stable transcripts across Mandarin, English, and code-switched speech.
- Keep frequent, simple decisions local to minimize API cost and network variance.
- Escalate difficult reasoning to Hermes without blocking control commands or losing task state.
- Block irreversible, externally consequential, or paid actions in the first release; do not execute them without a future approval protocol.
- Make latency, routing, cost, errors, and recovery paths measurable.

### Non-goals for the first release

- Maximizing GPU utilization or forcing all intelligence onto the local machine.
- Having the Supervisor generate long-form answers or perform deep research.
- Assigning a separate model process to every named agent role.
- Guaranteeing production latency before measurement on the target machine.

## 3. System architecture

### 3.1 Real-time data path

```text
Web App / browser                                      Local voice service

Microphone
    -> getUserMedia (permission + AEC/NS/AGC)
    -> AudioWorklet (16 kHz mono PCM, ~20 ms frames, pre-roll)
    -> binary WebSocket frames ----------------------> Silero VAD -> Qwen3-ASR

TTS playback -> browser speaker -> acoustic echo -> microphone
                    ^                     |
                    +---- AEC reference --+
```

The browser is only the acoustic front end and transport in this target path. It does not insert browser-native speech recognition, transcript routing, or an LLM between the microphone and Silero VAD. This design assumes the browser and voice service are on the same host or a low-latency LAN. A remote deployment must separately benchmark network jitter and use HTTPS/WSS because microphone capture is restricted to secure contexts outside browser-recognized local origins.

1. **Browser microphone ingress** obtains the user's real microphone through `navigator.mediaDevices.getUserMedia`. Request browser echo cancellation, noise suppression, and automatic gain control, then inspect the selected track's `getSettings()` result because constraints express requested behavior and actual settings may vary by browser, OS, and device. An AudioWorklet performs non-blocking capture, resamples to 16 kHz mono PCM, and initially targets approximately 20 ms frames over the existing WebSocket transport. Benchmark the framing interval and resampler cost; do not treat 20 ms as universally optimal. Do not use large `MediaRecorder` blobs on the conversational hot path.
2. **Capture continuity** keeps a short circular pre-roll buffer, with 250 ms as an initial benchmark value, so speech onset is not clipped by browser scheduling, network delivery, or VAD activation. Tune this value against clipped-onset rate and added latency rather than treating it as fixed. WebSocket ordering preserves frame order; capture timestamps and frame counters support latency diagnosis.
3. **Echo and fallback handling** keeps microphone capture available during TTS so real barge-in remains possible, while browser AEC and output-reference self-trigger suppression prevent the speaker output from reopening the turn. If the browser cannot provide usable AEC or microphone permission, switch to push-to-talk or text input.
4. **Silero VAD** runs on the receiving voice service and is authoritative for speech boundaries. Browser RMS/activity may update the UI optimistically but must not finalize the utterance. VAD consumes the WebSocket PCM frames directly, uses the pre-roll when speech begins, and applies a tunable endpoint grace window so short pauses do not split natural speech.
5. **Qwen3-ASR 1.7B** emits streaming partial text and a final hypothesis. The hot path does not assume native word timestamps or calibrated confidence scores.
6. **Transcript Stabilizer** converts changing hypotheses into an append-only stable prefix plus a replaceable tentative suffix. It normalizes punctuation conservatively, preserves Chinese-English terms, and suppresses duplicate fragments.
7. **Qwen3 1.7B Supervisor/Orchestrator** classifies intent, selects a worker role or Hermes, decides whether clarification or a first-release policy block is required, and emits a structured routing decision.
8. **Worker execution** uses specialized roles for bounded tasks. A role may be a prompt, tool policy, or state configuration on a shared model; it does not necessarily imply a separately loaded model.
9. **Response Coordinator** merges partial results, prevents stale responses, handles response interruption separately from explicit task cancellation, and streams final text to the real voice output layer.

### 3.2 Qwen3-ASR streaming contract

The local streaming baseline uses the official `qwen-asr[vllm]` backend. Its streaming mode returns incremental transcription text but does not return timestamps. Record speech start/end and endpoint timing in the VAD and pipeline trace instead. If word-level timestamps are later required, run `Qwen3-ForcedAligner-0.6B` after finalization as an optional, non-blocking step; do not put it on the first-response hot path. Treat ASR confidence as unavailable unless the selected runtime exposes a documented, calibrated signal. Transcript stability must be derived from hypothesis agreement and revision churn rather than fabricated confidence values. See the [official Qwen3-ASR streaming documentation](https://github.com/QwenLM/Qwen3-ASR#streaming-inference).

The official vLLM runtime requires Linux and does not natively support Windows. On the target Windows machine, the supported baseline therefore requires a functioning WSL2 Linux distribution or a GPU-enabled Linux container. A community Windows fork is an experimental alternative, not the default baseline. Before implementation proceeds, the environment must pass a Linux-side `nvidia-smi` check and a Qwen3-ASR streaming smoke test. See the [official vLLM GPU installation requirements](https://docs.vllm.ai/en/latest/getting_started/installation/gpu.html).

Co-residency on 12 GB VRAM is a hypothesis to test, not an established fact. Record total board usage and per-process deltas from an idle baseline; include model weights, KV cache, activations, CUDA/vLLM workspaces, TTS, and display/host usage. Do not launch independent vLLM services with unconstrained default memory reservations. Benchmark at least a BF16 ASR plus quantized Supervisor configuration against any all-BF16 candidate, and reject configurations that meet average latency only by operating without repeatable memory headroom.

### 3.3 Control path

Commands such as `听我说` / `stop speaking`, `cancel task`, `continue`, `status`, and `repeat` should first pass through a deterministic command recognizer and state machine. `听我说`, `stop speaking`, or a barge-in interrupts only the current response/TTS turn. `Cancel task` targets an explicit foreground or background job and may propagate to cancellable child jobs. A bare `stop` or `cancel` must be resolved from the active state only when the target is unambiguous; otherwise ask a short clarification. The Supervisor handles ambiguity, not the obvious cases. This reduces latency and prevents a generative model from overriding control semantics.

### 3.4 Recommended logical roles

| Role | Primary responsibility | Typical execution |
|---|---|---|
| Supervisor | Intent, routing, decomposition, risk class, escalation | Local Qwen3 1.7B |
| Conversation worker | Short conversational answers and clarification | Shared local runtime where suitable |
| Tool worker | Bounded tool use under an allowlist and timeout | Role configuration; local or service-backed |
| Retrieval worker | Search or internal knowledge retrieval | Tool-backed role |
| Heavy reasoning worker | Multi-step analysis, synthesis, or difficult planning | Hermes API |
| Response Coordinator | Ordering, cancellation, deduplication, streaming, voice handoff | Deterministic service/state machine |

## 4. Transcript stabilization and bilingual behavior

Maintain each turn transcript as `{stablePrefix, tentativeSuffix, revisionId}`. Only the tentative suffix may be replaced. Commit text after endpointing or when text-agreement and revision-churn thresholds are met. The Supervisor normally routes from committed text; an early route may be prepared from partial text but must be invalidated if the revision changes meaning.

For Chinese-English code-switching:

- Preserve product names, file paths, commands, acronyms, and English technical terms instead of translating them automatically.
- Avoid aggressive spacing or punctuation normalization that corrupts mixed-language tokens.
- Maintain a session glossary for names and domain terms, and log corrections for later evaluation.
- Benchmark Mandarin, English, and mixed utterances separately; aggregate accuracy alone can hide code-switching failures.

## 5. Task state, job queue, and concurrency

Every accepted request creates a logical task with a stable `taskId` and a root execution job. The Supervisor may create child jobs when it delegates work to the agent pool. Each job carries parent/child links, transcript revision, intent, risk class, route, deadline, a response-interruption token, an explicit task-cancellation token, and a cost/latency budget.

Recommended first-release transitions:

```text
RECEIVED -> STABILIZING -> ROUTED
ROUTED -> BLOCKED_POLICY | QUEUED
QUEUED -> RUNNING
RUNNING -> WAITING_DEPENDENCY | COMPLETED | FAILED | CANCELLED
WAITING_DEPENDENCY -> RUNNING | FAILED | CANCELLED
```

### 5.1 Canonical trace context and visibility

The pipeline uses one canonical trace context, not two independent identity systems. The Supervisor, scheduler, workers, Hermes calls, Response Coordinator, and logging layer propagate the same context. The WebSocket/UI contract receives only the public projection it needs; internal structured logs retain the complete context for debugging and agent-performance review.

```json
{
  "traceId": "trace_01",
  "sessionId": "sess_001",
  "turnId": "turn_042",
  "revisionId": 3,
  "taskId": "task_501",
  "jobId": "job_501_02",
  "parentJobId": "job_501_01",
  "routeId": "route_501_02",
  "agentId": "research",
  "attempt": 2
}
```

Identifier responsibilities:

- `traceId`: correlates one accepted user turn with all routing, worker, Hermes, and response activity it causes.
- `sessionId`: identifies the conversation and remains stable across WebSocket reconnects.
- `turnId`: identifies the user voice/text turn and also serves as the speech-utterance identifier. Do not create a duplicate `utteranceId` unless a later requirement proves that one turn must contain independently addressable audio segments.
- `revisionId`: increments when the ASR hypothesis for the same `turnId` changes meaningfully.
- `taskId`: identifies the stable logical task presented to task tracking. It survives retries and worker reassignment.
- `jobId`: identifies one concrete execution node assigned to a worker. Delegation creates child jobs linked by `parentJobId`.
- `routeId`: identifies one Supervisor routing decision. A retry or reroute creates a new `routeId` without changing the logical `taskId`.
- `agentId`: identifies the worker that executed the job; `attempt` distinguishes retries by the same worker.

Visibility rules:

- Web UI events keep `sessionId`, `turnId`, `taskId`, and `seq`, plus user-meaningful task summaries. The UI does not receive `revisionId`, `jobId`, `parentJobId`, or `routeId`, and does not render internal routing attempts or worker-execution nodes by default.
- Internal logs include the complete trace context on every route decision, state transition, worker start/progress/end event, retry, cancellation, Hermes call, and response chunk.
- Adapter boundaries must propagate IDs rather than generate replacements. Retries preserve `traceId`, `sessionId`, `turnId`, and `taskId`, while creating a new `jobId` or incrementing `attempt` as appropriate.
- Structured log records include event name, monotonic and wall-clock timestamps, previous/new state, model/runtime version, latency, token/cost counters, normalized error code, and redacted input/output hashes. The complete delegation tree can be reconstructed by querying `traceId` and following `parentJobId` links.
- Logs may be stored as JSONL initially and exported to a tracing backend later. Retention and redaction policy applies before persistence. Optional redacted transcript/result samples may be retained under an explicit sampling policy when semantic quality review is required.

Rules:

- Use per-session ordering for conversational turns, but allow independent child jobs to run concurrently.
- Apply bounded queues and backpressure. When saturated, acknowledge the delay rather than silently accumulating work.
- `USER_INTERRUPT` or `stop speaking` cancels only in-flight response generation and TTS for the current conversational turn. Background and child jobs continue; their results may update task state but must not be spoken into the interrupted turn.
- `TASK_CANCEL` or an unambiguous `cancel task` targets a job explicitly. Only this path propagates cancellation to cancellable descendants. A non-cancellable external action reports its actual state instead of pretending cancellation succeeded.
- Discard late voice responses using job ID and transcript revision checks, while preserving valid background-task completion events.
- Use idempotency keys for tool calls so retries do not repeat external side effects.
- Persist compact checkpoints for recoverable long-running jobs; keep ephemeral audio buffers short-lived.

## 6. First-release action policy

Classify actions before execution:

- **Read-only or explicitly allowlisted local reversible:** may run automatically within the user's scope when the deterministic execution policy permits the exact adapter and operation.
- **Externally visible, paid, irreversible, or high-impact:** return `BLOCKED_POLICY` and do not execute in the first release.

Blocked first-release examples include sending messages, publishing content, purchases, destructive file changes, account or permission changes, and trades. The Supervisor classifies and explains the block, but the deterministic execution layer enforces it independently. A user-approval protocol and `WAITING_APPROVAL` state are explicitly deferred; they are not part of the first-release state machine or acceptance criteria.

## 7. Routing and cost policy

Use local execution when the task is short, bounded, latency-sensitive, privacy-sensitive, or confidently supported by local tools. Route to Hermes when the task requires deep multi-step reasoning, long-context synthesis, difficult ambiguity resolution, or when local confidence falls below the calibrated threshold.

Each route decision should include `route`, `reason_code`, `confidence`, `risk_class`, `estimated_cost_band`, and `deadline_ms`. Apply a per-session cloud budget and a circuit breaker. If the cloud budget or service is unavailable, return a useful degraded response or ask the user whether to wait; do not loop retries indefinitely.

Supervisor escalation order:

1. Qwen3 1.7B local baseline.
2. Improve prompts, schema constraints, examples, and deterministic pre-routing.
3. If routing quality still misses the acceptance gate, test a larger/quantized local Supervisor.
4. Use Hermes for genuinely difficult decisions rather than as the default router.

## 8. Failure handling and recovery

| Failure | Detection | Recovery behavior |
|---|---|---|
| False VAD endpoint / clipped speech | Rapid resume, incomplete syntax | Reopen the utterance within a grace window; merge audio and restabilize |
| ASR uncertainty or code-switch error | Low stability, glossary mismatch, user correction | Ask a short clarification or replay the uncertain span; do not execute risky intent |
| Supervisor timeout or malformed output | Deadline/schema validation failure | Retry once with constrained schema, then use deterministic fallback or Hermes |
| Worker timeout | Missed deadline/heartbeat | Cancel, retry only if idempotent, or re-route; preserve job state |
| Hermes unavailable | Timeout, network error, circuit open | Use local degraded answer, queue with user consent, or return a precise status |
| Stale/late result | Job cancelled or transcript revision changed | Drop result and record it as stale; never speak it |
| Voice output failure | Playback/TTS health signal | Return text immediately and keep the job complete |

All retries need bounded exponential backoff, a retry budget, and a terminal state. User-facing errors should say what completed, what failed, and whether anything external changed.

## 9. Observability and latency metrics

Create one trace per accepted user turn and propagate the canonical `traceId`, `sessionId`, `turnId`, `revisionId`, `taskId`, `jobId`, `parentJobId`, `routeId`, `agentId`, and `attempt` context. Record:

- VAD speech-start detection and endpoint delay.
- ASR first partial, finalization delay, real-time factor, corrections, and language-mix accuracy. Record runtime-provided confidence only when documented and calibrated; otherwise record hypothesis churn and agreement metrics.
- Stabilizer churn rate, stable-prefix time, and meaning-changing revisions.
- Supervisor time to first token, route latency, schema validity, confidence, and route correctness.
- Queue wait, worker duration, Hermes network/server duration, retries, and cancellations.
- Time to acknowledgement, time to first spoken audio, total turn time, barge-in stop time, and stale-response count.
- Peak/steady VRAM, GPU compute, RAM, thermal throttling, API tokens, estimated cost, and local-versus-cloud share.

Report p50, p95, and p99 latency. Redact or hash transcript content by default; retain raw audio/transcripts only with an explicit policy and short retention window.

## 10. Initial benchmark plan

### Deterministic correctness suite

The repository's automated gate uses fixed fixtures and recorded event traces. It must not require a live microphone, a live Hermes service, an external LLM API, or manual speech.

- Store versioned PCM/WAV fixtures plus expected VAD boundaries, transcript checkpoints, final text, control-command classification, route label, and terminal state.
- Replay recorded ASR partial/final hypotheses to test the Transcript Stabilizer, routing schema, stale-result suppression, and response ordering without loading a GPU model.
- Include deterministic interruption fixtures proving that `USER_INTERRUPT` stops only response/TTS work and that `TASK_CANCEL` alone propagates to child jobs.
- Mock Hermes success, timeout, circuit-open, retry, and late-result paths with fixed JSONL traces.
- Keep expected outputs in `test-fixtures/` and require exact or explicitly normalized assertions.

### Target-hardware and model benchmark

Run the following separately from the deterministic CI gate on the RTX 4070 Ti system:

- Languages: Mandarin, English, and natural Chinese-English code-switching.
- Conditions: quiet room, fan/keyboard noise, far-field speech, fast speech, pauses, and interruption.
- Utterances: control commands, short questions, multi-intent requests, tool tasks, ambiguous requests, and heavy-reasoning prompts.
- Load: single turn, sustained dialogue, ASR plus Supervisor overlap, concurrent child jobs, and degraded network/API.

Use a versioned scripted corpus of at least 150 utterances with a balanced language split and repeat the functional run at least three times after warm-up. Use 20 minutes of unscripted dialogue for exploratory defect discovery, not as a deterministic pass/fail gate. For p99 latency, predeclare the sample-size and confidence-interval method and report both with the result. One thousand valid turns provide only about ten observations in the slowest 1%, so treat that as a diagnostic floor rather than proof of a stable p99 release gate.

### Provisional acceptance gates

These are initial engineering targets, not promises; revise them after the first hardware run.

| Area | Initial gate |
|---|---|
| Control commands | >=99% correct action; zero ambiguous `stop`/`cancel` commands applied to the wrong target |
| Supervisor routing | >=95% route accuracy overall; 100% of prohibited benchmark actions classified as `BLOCKED_POLICY` |
| First-release action safety | Zero externally visible, paid, irreversible, or high-impact benchmark actions executed |
| Transcript stability | No meaning-changing committed rewrite in >=99% of evaluated turns |
| Code-switching | Key names/commands/technical terms preserved in >=95% of mixed utterances |
| Local response latency | p95 <=1.2 s to acknowledgement; p95 <=2.0 s to first spoken audio for simple local turns |
| Barge-in | p95 <=300 ms from detected interruption to voice-output stop |
| Cancellation isolation | Zero background or child jobs cancelled by `USER_INTERRUPT`; explicit `TASK_CANCEL` reaches the intended cancellable descendants |
| Reliability | >=99% jobs reach a correct terminal state; zero stale responses spoken |
| GPU envelope | No out-of-memory events; measure total-board and per-process VRAM from an idle baseline, and preserve repeatable headroom during worst-case ASR, Supervisor, and TTS overlap. The provisional <=10 GB steady and <=11 GB transient total-board targets must be revalidated on the actual host workload. |

### Comparison runs

1. Qwen3-ASR 1.7B + Qwen3 1.7B Supervisor, warmed and resident.
2. Same models with deterministic control-command bypass enabled versus disabled.
3. Local-only routing versus calibrated Hermes escalation.
4. If route quality fails: prompt/schema improvements, then a larger quantized Supervisor candidate.

The first decision gate is based on route quality, tail latency, VRAM headroom, and cost per successful turn—not raw GPU utilization.

## 11. Implementation phases

1. **Platform preflight:** provide a supported Linux runtime through WSL2 or a GPU-enabled container, verify Linux-side GPU access, and complete a Qwen3-ASR streaming smoke test without out-of-memory failure.
2. **Instrumented skeleton:** event IDs, state machine, bounded queue, cancellation, structured trace logs, and mock workers.
3. **Real browser audio ingress:** replace Web Speech API transcription with Web App `getUserMedia`, verify applied AEC/NS/AGC settings, add AudioWorklet PCM framing/resampling, and send binary audio through the WebSocket client.
4. **Streaming speech service:** ingest binary audio instead of discarding it, then add Silero VAD, Qwen3-ASR 1.7B through the vLLM streaming backend, stabilizer, glossary, and code-switch corpus.
5. **Local Supervisor:** structured route schema, deterministic command bypass, confidence calibration, risk classification, and `BLOCKED_POLICY` enforcement.
6. **Workers and Hermes:** role registry, tool policies, budgets, circuit breaker, and fallback behavior.
7. **Real voice output and response coordination:** implement streaming TTS generation and audible browser playback, then add streaming merge, late-result suppression, and barge-in.
8. **Benchmark and tune:** collect p50/p95/p99, validate safety gates, tune thresholds, and decide whether Supervisor escalation is justified.

## 12. Open decisions after baseline measurement

- Exact ASR decoding and endpointing parameters for mixed-language speech.
- Whether post-final word timestamps justify loading or scheduling Qwen3-ForcedAligner-0.6B outside the conversational hot path.
- Supervisor context-window, quantization, and serving runtime. The ASR streaming baseline remains the official vLLM backend.
- Confidence thresholds for clarification and Hermes escalation.
- Per-session cloud budget and transcript/audio retention policy.
- Whether a larger local Supervisor improves route quality enough to justify added latency and VRAM pressure.

## 13. Final recommendation

Begin with **Qwen3-ASR 1.7B** and **Qwen3 1.7B Supervisor** resident locally on the RTX 4070 Ti 12GB. Keep the Supervisor narrow and structured, place control semantics and safety enforcement in deterministic services, and use Hermes selectively for heavy reasoning. Benchmark before scaling the model: the system succeeds when it is responsive, stable, safe, and economical—not when the GPU is merely full.
