#!/usr/bin/env bash
set -euo pipefail

include_models="${1:-false}"
include_tts="${2:-false}"
service_user="liveagent"
runtime_root="/opt/livechat-agent"
uv_version="0.8.13"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "bootstrap-wsl.sh must run as root" >&2
  exit 2
fi

if grep -q 'bullseye-backports' /etc/apt/sources.list 2>/dev/null; then
  sed -i '/bullseye-backports/d' /etc/apt/sources.list
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl git ffmpeg libsndfile1 sox espeak-ng build-essential

if ! id "${service_user}" >/dev/null 2>&1; then
  useradd --create-home --shell /bin/bash "${service_user}"
fi
install -d -o "${service_user}" -g "${service_user}" "${runtime_root}"

if [[ ! -x /usr/local/bin/uv ]] || [[ "$(/usr/local/bin/uv --version | awk '{print $2}')" != "${uv_version}" ]]; then
  installer="$(mktemp)"
  trap 'rm -f "${installer}"' EXIT
  curl --proto '=https' --tlsv1.2 -LsSf "https://astral.sh/uv/${uv_version}/install.sh" -o "${installer}"
  UV_INSTALL_DIR=/usr/local/bin sh "${installer}"
fi

repo_path="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
runuser -u "${service_user}" -- /usr/local/bin/uv python install 3.12
if [[ ! -x "${runtime_root}/.venv/bin/python" ]]; then
  runuser -u "${service_user}" -- /usr/local/bin/uv venv "${runtime_root}/.venv" --python 3.12
else
  existing_python_version="$("${runtime_root}/.venv/bin/python" -c 'import sys; print(str(sys.version_info.major) + "." + str(sys.version_info.minor))')"
  if [[ "${existing_python_version}" != "3.12" ]]; then
    echo "Existing Runtime virtual environment is not Python 3.12; refusing to overwrite it automatically." >&2
    exit 3
  fi
fi
runuser -u "${service_user}" -- /usr/local/bin/uv pip install --python "${runtime_root}/.venv/bin/python" -r "${repo_path}/requirements-runtime.txt"

if [[ "${include_models}" == "true" ]]; then
  runuser -u "${service_user}" -- /usr/local/bin/uv pip install \
    --python "${runtime_root}/.venv/bin/python" \
    -r "${repo_path}/requirements-vad.txt" \
    -r "${repo_path}/requirements-model.txt"
fi

if [[ "${include_tts}" == "true" ]]; then
  if [[ ! -x "${runtime_root}/.venv-tts/bin/python" ]]; then
    runuser -u "${service_user}" -- /usr/local/bin/uv venv "${runtime_root}/.venv-tts" --python 3.12
  fi
  runuser -u "${service_user}" -- /usr/local/bin/uv pip install \
    --python "${runtime_root}/.venv-tts/bin/python" \
    -r "${repo_path}/requirements-tts.txt"
  if [[ ! -x "${runtime_root}/.venv-tts-fast/bin/python" ]]; then
    runuser -u "${service_user}" -- /usr/local/bin/uv venv "${runtime_root}/.venv-tts-fast" --python 3.12
  fi
  runuser -u "${service_user}" -- /usr/local/bin/uv pip install \
    --python "${runtime_root}/.venv-tts-fast/bin/python" \
    -r "${repo_path}/requirements-tts-fast.txt"
fi

"${runtime_root}/.venv/bin/python" --version
nvidia-smi --query-gpu=name,driver_version,memory.total --format=csv,noheader
