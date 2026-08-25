# 02 - Tech Design: Release Validation

**Status:** Accepted

**Target features:** FEAT-030 through FEAT-032

## Components

### `runtime/evaluation.py`

Pure deterministic scoring primitives:

- NFKC/case/whitespace/punctuation normalization.
- Levenshtein edit distance.
- Mandarin character error rate (CER).
- English word error rate (WER).
- Mixed token error rate using Han characters plus English/alphanumeric tokens.
- Key-term preservation and exact command correctness.
- Group and overall summaries using the existing deterministic percentile/bootstrap utilities.
- Strict threshold evaluation with explicit sample counts and no p99 for fewer than 1,000 samples.

No model imports, network access, clocks, or random behavior outside the seeded statistics helper.

### `test-fixtures/v0.2/asr-corpus/`

Twelve immutable mono 16 kHz PCM WAVs and `manifest.json`. Each record contains:

- stable ID and language group;
- reference transcript;
- expected route and optional command type;
- key terms;
- WAV path, SHA-256, frame count, duration;
- source TTS model/revision, voice, generation script version, and limitation label.

`scripts/build-asr-corpus.py` calls only an explicitly supplied local/private Kokoro endpoint, resamples deterministically, writes the corpus, and supports `--check` hash/provenance verification without synthesis.

### `scripts/evaluate-release.py`

A bounded production WebSocket evaluator:

1. validates corpus hashes;
2. opens protocol-v2 sessions;
3. streams each WAV in real-time 20 ms frames with leading/trailing silence;
4. records VAD start/end, partial/final transcript, route/task terminal result, correlated TTS first binary, and idle terminal state;
5. scores zh/en/code-switch and key terms/commands/routes;
6. runs fixed text routing/policy cases against deterministic in-process boundaries;
7. records per-segment latency and terminal-state counts;
8. samples NVIDIA board memory, temperature, and power in a bounded background sampler;
9. writes one atomic JSON report to an explicit output path.

The script fails nonzero on missing/duplicate terminals, timeout, malformed protocol, corpus mismatch, threshold failure, or unsafe GPU envelope.

### `scripts/verify-release.ps1`

Operational evaluator for this Windows/WSL deployment:

- confirms current health and singleton GPU engine;
- runs deterministic suite, lint, build, audit, fixtures, and isolated gateway smoke;
- performs clean stop, validates stopped state, terminates only Debian, cold-starts with ASR prewarm, validates health/provenance, and runs release evaluation;
- verifies unsafe CUDA Kokoro and ASR/Supervisor profiles remain rejected through non-mutating guard tests;
- preserves production running on success and emits a machine-readable operations summary.

It never unregisters WSL, deletes environments, exposes ports, starts CUDA Kokoro, or modifies system security.

## Protocol observation

Evaluation consumes existing public protocol events only. No private trace graph is added to the UI. Browser-only metrics (AEC, underruns, acoustic interruption) are imported as fixed evaluator evidence from Phase 6 and cross-referenced in the final report.

For voice cases, latency anchors are:

- `captureEndSentAt`;
- `speechStartReceivedAt`;
- `sttFinalReceivedAt`;
- first task event;
- first `TEXT_DELTA`;
- `TTS_START`;
- first binary audio;
- terminal `TTS_END`;
- final idle state.

Because the fixed audio contains trailing silence, `captureEndSentAt -> first audio` is conservative and reproducible. Results are target-host measurements, not population SLAs.

## Bounds

- Corpus: exactly 12 items, maximum 12 seconds each.
- WebSocket receive timeout: 120 seconds per live voice case.
- PCM pacing: 20 ms/frame; client buffered amount is not used as an unbounded queue.
- Production terminal sample: 12 voice cases plus at least 20 bounded text turns.
- Deterministic terminal soak: at least 100 turns.
- GPU sampler: 1 Hz, bounded to evaluator lifetime.
- Report size: maximum 4 MiB; transcript text bounded by existing protocol limits.
- No raw microphone or user audio is recorded by evaluation.

## Failure handling

- Corpus mismatch: stop before model calls.
- VAD/ASR timeout or empty final: record case failure, close session, continue only if GPU/service remains healthy.
- Response failure: transcript can score, but terminal reliability fails.
- GPU process count > 1, peak > 8 GiB, temperature >= 85 C, or headroom < 3.5 GiB: fail the capacity gate.
- Recovery failure: attempt one documented clean stop/start; leave explicit status and logs, never fake success.
- Any blocked-policy case allowed: immediate safety failure.

## Tests

- Exact normalization/tokenization/edit-distance vectors.
- CER/WER/mixed error and zero-reference behavior.
- Key-term and command scoring.
- Group threshold decisions and p99 qualification.
- Corpus manifest/hash checking.
- Evaluator event collector ordering, duplicate terminal rejection, timeout, and response-only interruption.
- Operations script dry-run/status parsing where deterministic.

## Acceptance

Tech Design is accepted. Proceed to Execution Brief.
