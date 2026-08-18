# Testing Contracts

- All tests must be deterministic and run against `test-fixtures/seed-data.json`.
- Evaluator must run automated test suites and verify exit codes and assertions.
- Do not write non-deterministic tests (e.g. relying on real time or external unmocked APIs).
- Verification reports must contain actual test command outputs.
