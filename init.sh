#!/usr/bin/env bash
set -euo pipefail

required_node_major=24

if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: Node.js 24.19.0 or newer is required." >&2
  exit 1
fi

node_major="$(node --version | sed -E 's/^v([0-9]+).*/\1/')"
if [[ "${node_major}" -lt "${required_node_major}" ]]; then
  echo "ERROR: Node $(node --version) is unsupported; use Node 24.19.0 or newer." >&2
  exit 1
fi

for required_file in \
  test-fixtures/seed-data.json \
  test-fixtures/v0.2/manifest.json \
  stage-gates/01-discovery-brief.md \
  stage-gates/02-tech-design.md \
  stage-gates/03-execution-brief.md \
  stage-gates/04-verification-report.md; do
  if [[ ! -f "${required_file}" ]]; then
    echo "ERROR: required repository file is missing: ${required_file}" >&2
    exit 1
  fi
done

npm ci
npm run test:all
npm run lint
npm run build

echo "livechat_agent deterministic sandbox initialized successfully."
