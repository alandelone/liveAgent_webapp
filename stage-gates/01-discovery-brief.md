# 01 - Discovery Brief: Release Validation

**Status:** Accepted

**Target features:** FEAT-030 through FEAT-032

## Release question

Can the verified local-first voice system be released on this exact Windows 11 / Debian WSL2 / RTX 4070 Ti host with measured bilingual quality, conversational latency, bounded GPU and memory behavior, reliable terminal states, and recoverable operations?

Phase 7 adds evaluation and release evidence only. It does not broaden the first-release policy, expose services beyond localhost/private WSL transport, enable CUDA Kokoro, or re-enable Hermes tools.

## Current verified baseline

- FEAT-001 through FEAT-029 are evaluator-passed.
- Production topology is target Chrome + Windows CPU Kokoro + Debian WSL Qwen3-ASR.
- One prewarmed shared ASR GPU engine is required; per-browser model residency is forbidden.
- The target human acoustic phrase `听我说` interrupts response audio in 0.100 ms without cancelling task work.
- Deterministic routing has 24 labeled Mandarin/English/code-switch cases; policy has 12 allow/block cases.
- Existing synthetic audio fixtures prove framing/VAD mechanics but do not by themselves prove ASR language quality.

## Evidence gaps

### FEAT-030 quality

A versioned, byte-identified ASR evaluation corpus is required for Mandarin, English, and natural code-switch text. Each item needs a reference transcript, language group, key terms, command expectation, and route label. Report group-specific CER, WER, mixed token error rate, key-term preservation, command correctness, route correctness, policy correctness, and terminal worker outcome.

The first release may use a fixed selected-TTS corpus for reproducible model regression, but must label that limitation and retain the real human `听我说` acoustic result separately. Synthetic speech cannot be described as population-level human accuracy.

### FEAT-031 performance

Measure end-to-end voice timing segments, first audio, route and queue wait, TTS synthesis, interruption, underruns, board/process VRAM, idle baseline, temperature, power, and terminal-state reliability. Report p50 and p95. Report p99 only for at least 1,000 samples; otherwise explicitly omit it. Small-sample percentiles are evidence for this host/profile, not universal SLAs.

### FEAT-032 operations

Prove status, clean stop, cold start with ASR prewarm, restart after WSL termination, stale-state handling, unsafe GPU-profile refusal, isolated deterministic smoke coexistence, explicit failure diagnostics, and final production health. Preserve logs and a machine-readable release report.

## Falsifiable hypotheses

| ID | Hypothesis | Pass condition | Failure meaning |
|---|---|---|---|
| Q1 | Qwen ASR preserves release commands and technical terms across all language groups | Commands 100%; key terms >= 85%; no empty finals | Corpus/model quality blocks release |
| Q2 | Group accuracy is usable for the fixed regression corpus | zh CER <= 0.35; en WER <= 0.30; mixed token error <= 0.40 | Tune glossary/model or fail honestly |
| Q3 | Deterministic control quality remains exact | routes 24/24; policies 12/12; exact commands 100% | Release safety regression |
| P1 | Voice response remains conversational on the selected profile | voice first-audio p50 <= 3 s and p95 <= 8 s | Hot path requires optimization |
| P2 | Browser playback and barge-in remain bounded | zero overrun; underrun rate <= 1%; human stop <= 300 ms | Full-duplex release fails |
| P3 | GPU remains within the proven envelope | one engine; peak board usage <= 8 GiB; >= 3.5 GiB headroom; temperature < 85 C | Capacity profile invalid |
| R1 | Every benchmark turn reaches one legal terminal outcome | 100% terminal states; no duplicate terminal markers | Reliability release blocker |
| R2 | Supported recovery is repeatable | all documented stop/start/WSL recovery checks pass | Operations release blocker |
| R3 | Unsafe profiles fail closed | concurrent CUDA Kokoro guard and real-ASR+real-Supervisor refusal pass | Safety boundary regression |

## Corpus and sampling decision

The fixed ASR regression corpus contains 12 utterances: four Mandarin, four English, and four code-switch cases, including `听我说`, current-status, research, browser, and coding intents. Audio is generated once with the pinned selected Kokoro backend, resampled to 16 kHz mono PCM, stored as immutable WAV, and hashed in a manifest. This is reproducible regression evidence rather than a claim about diverse speakers or noisy environments.

Live quality/performance evaluation runs through the production WebSocket, server Silero VAD, prewarmed Qwen ASR, deterministic Supervisor, response coordinator, CPU Kokoro, and correlated binary output. At least 12 voice turns are reported. Reliability adds at least 100 deterministic turns and 20 production text/voice terminal turns. p99 remains unreported unless the sample count reaches 1,000.

## Required artifacts

- Versioned ASR corpus WAVs and manifest with hashes/provenance.
- Deterministic scoring library and tests.
- Release evaluator/benchmark script with JSON output.
- Machine-readable report under `.runtime-data/release/`.
- Updated deployment runbook with prewarm, recovery, capacity, and known limitations.
- Final Phase 7 verification report and archived copy.

## Gate decision

Discovery is accepted. Proceed to Tech Design. No FEAT-030 through FEAT-032 pass until the complete evaluator report proves every applicable threshold and documents any statistically unqualified metric.
