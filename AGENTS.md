# Repository Guidelines

## Project Structure & Module Organization
- `AGENTS.md`: Entry point, roles, and repository invariants (always in context).
- `mission_status.json` & `feature-list.json`: Single source of truth for pipeline status and feature pass states.
- `init.sh`: Environment bootstrap script (services, database, seed data).
- `docs/`: Architecture overview (`project-index.md`) and API specifications (`api-contracts/`).
- `rules/`: Modular constraints (`general-rules.md`, `testing-contracts.md`, `linting-guidelines.md`).
- `stage-gates/`: Strict unidirectional pipeline contracts (`01-discovery-brief.md` -> `02-tech-design.md` -> `03-execution-brief.md` -> `04-verification-report.md`).
- `active-session/`: Ephemeral execution context (`progress.md`) and agent handoff (`HANDOFF.md`).
- `repomemory/`: Long-term system invariants (`project-context.md`), decisions (`decision.md`), debugging logs (`findings.md`), and historical corrections (`lessons-learned.md`).
- `test-fixtures/`: Deterministic testing fixtures (`seed-data.json` / `seed-data.sql`).

## Agent Roles & Stage Gates
1. **Planner**: Analyzes problem space (`01-discovery-brief.md`), creates tech design (`02-tech-design.md`), and defines execution DoD (`03-execution-brief.md`).
2. **Generator**: Implements code and unit tests based strictly on `03-execution-brief.md`; logs actions to `active-session/progress.md`.
3. **Evaluator**: Executes deterministic tests and logs proof in `04-verification-report.md`; updates `feature-list.json` upon complete pass.

## Build, Test, and Development Commands
- `./init.sh`: Bootstrap local environment, services, and seed data.
- `npm run dev` / `npm start`: Start local development server.
- `npm test`: Run automated test suites against `test-fixtures/seed-data.json`.
- `npm run lint`: Run static analysis and linter checks.
- `npm run format`: Format code to repository standards.

## Coding Style & Testing Guidelines
- **Style**: Follow modular constraints in `rules/general-rules.md`. Indent with 2 spaces; enforce formatting via linter before committing.
- **Testing**: Deterministic assertions only. All integration/E2E tests must validate against fixed fixtures in `test-fixtures/`. Flaky assertions and untested PRs are rejected. Refer to `rules/testing-contracts.md`.

## Commit & Pull Request Guidelines
- **Commit Format**: Conventional Commits (`feat:`, `fix:`, `refactor:`, `test:`, `docs:`).
- **Handoff**: On session end or context limit, write final status, blockers, and next steps to `active-session/HANDOFF.md`.
- **PR Requirements**: Every PR must reference the corresponding feature ID from `feature-list.json`, link passing gate `04-verification-report.md`, and confirm clean lint/test runs.

## Core Invariants & Guardrails
- Never skip stage gates or mark features `passes: true` in `feature-list.json` without evaluator proof.
- Keep `AGENTS.md` under 100 lines; disclose detailed specifications inside `rules/` and `docs/`.
- Consult `repomemory/decision.md` and `repomemory/lessons-learned.md` before altering architecture.
