# 02 - Technical Design: Phase 2 Architecture, Platform & Evidence

**Status:** Pending 01-discovery acceptance
**Target features:** FEAT-014 through FEAT-017

This gate is intentionally not pre-approved. It will be written only after every item in `01-discovery-brief.md` is resolved. Local Supervisor ownership is now accepted; runtime topology, versioned protocol migration, logging limits, and benchmark methodology still materially change the implementation design.

## Inputs required from discovery

- Accepted superseding ADR direction and component ownership.
- Selected WSL2/container/split-process topology.
- Candidate Supervisor runtime and quantization matrix.
- Logging retention, sampling, redaction, and volume limits.
- Deterministic fixture and benchmark schemas.

## Completion checklist

- [ ] Component and deployment diagrams defined.
- [ ] Runtime versions and interfaces pinned.
- [ ] Canonical trace schema and log sink/backpressure behavior defined.
- [ ] Fixture schemas and benchmark runner architecture defined.
- [ ] Failure handling and rollback paths defined.
- [ ] No implementation task relies on an unresolved hypothesis as if it were fact.
