#!/usr/bin/env bash
set -Eeuo pipefail

MODEL_STORAGE_PATH="${MODEL_STORAGE_PATH:-/var/lib/soko-models}"
OLLAMA_MODELS="${OLLAMA_MODELS:-${MODEL_STORAGE_PATH}/ollama}"
SOKO_PRIMARY_PROVIDER_MODEL_ID="${SOKO_PRIMARY_PROVIDER_MODEL_ID:-qwen2.5:0.5b}"
MODEL_AUTO_INSTALL="${MODEL_AUTO_INSTALL:-false}"
MODEL_MIN_FREE_BYTES="${MODEL_MIN_FREE_BYTES:-2147483648}"

export MODEL_STORAGE_PATH OLLAMA_MODELS SOKO_PRIMARY_PROVIDER_MODEL_ID
mkdir -p "${OLLAMA_MODELS}"

engine_pid=""
gateway_pid=""

terminate() {
  trap - TERM INT EXIT
  [[ -n "${gateway_pid}" ]] && kill -TERM "${gateway_pid}" 2>/dev/null || true
  [[ -n "${engine_pid}" ]] && kill -TERM "${engine_pid}" 2>/dev/null || true
  [[ -n "${gateway_pid}" ]] && wait "${gateway_pid}" 2>/dev/null || true
  [[ -n "${engine_pid}" ]] && wait "${engine_pid}" 2>/dev/null || true
}
trap terminate TERM INT EXIT

ollama serve &
engine_pid=$!
node services/ai-runtime/scripts/model-admin.mjs wait

if node services/ai-runtime/scripts/model-admin.mjs has; then
  echo "Configured model is present in persistent Ollama storage."
elif [[ "${MODEL_AUTO_INSTALL}" == "true" ]]; then
  available_kb="$(df -Pk "${MODEL_STORAGE_PATH}" | awk 'NR == 2 { print $4 }')"
  required_kb="$((MODEL_MIN_FREE_BYTES / 1024))"
  if [[ -z "${available_kb}" ]] || (( available_kb < required_kb )); then
    echo "Insufficient disk space for the configured model." >&2
    exit 1
  elif ollama pull "${SOKO_PRIMARY_PROVIDER_MODEL_ID}"; then
    echo "Configured model installed through Ollama's content-addressed pull."
  else
    echo "Configured model installation failed." >&2
    exit 1
  fi
else
  echo "Configured model is not installed and MODEL_AUTO_INSTALL is disabled." >&2
fi

node services/ai-runtime/dist/server.js &
gateway_pid=$!

set +e
wait -n "${engine_pid}" "${gateway_pid}"
exit_code=$?
set -e
echo "A required inference process exited with status ${exit_code}; stopping the container." >&2
exit "${exit_code}"
