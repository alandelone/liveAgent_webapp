#!/usr/bin/env bash
set -euo pipefail

endpoint="${1:-}"
repo_path="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
pid_file="${repo_path}/.runtime-data/deployment/gateway-linux.pid"

if [[ ! "${endpoint}" =~ ^http://(127\.0\.0\.1|10\.[0-9.]+|172\.(1[6-9]|2[0-9]|3[01])\.[0-9.]+|192\.168\.[0-9.]+):8771$ ]]; then
  echo "Refusing an invalid or non-private TTS endpoint." >&2
  exit 2
fi

mkdir -p "$(dirname "${pid_file}")"
printf '%s\n' "$$" > "${pid_file}"
cleanup() { rm -f "${pid_file}"; }
trap cleanup EXIT INT TERM

cd "${repo_path}"
export RUNTIME_TTS_ENDPOINT="${endpoint}"
set -a
source deployment/voice.env
set +a
exec /opt/livechat-agent/.venv/bin/python server.py
