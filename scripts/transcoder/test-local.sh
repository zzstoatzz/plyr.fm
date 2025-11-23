#!/usr/bin/env bash
# Simple helper to POST an audio file to the local transcoder API and save the result.
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "usage: $(basename "$0") <input-file> [output-file]" >&2
  exit 1
fi

INPUT_FILE="$1"
if [[ $# -ge 2 ]]; then
  OUTPUT_FILE="$2"
else
  OUTPUT_FILE="$(basename "${INPUT_FILE%.*}").mp3"
fi
PORT="${TRANSCODER_PORT:-8082}"
AUTH_TOKEN="${TRANSCODER_AUTH_TOKEN:-}"

CURL_ARGS=(
  --fail
  --silent
  --show-error
  -X POST
  -F "file=@${INPUT_FILE}"
)

# add auth header if token is set
if [[ -n "${AUTH_TOKEN}" ]]; then
  CURL_ARGS+=(-H "X-Transcoder-Key: ${AUTH_TOKEN}")
fi

curl "${CURL_ARGS[@]}" \
  "http://127.0.0.1:${PORT}/transcode?target=mp3" \
  --output "${OUTPUT_FILE}"

echo "wrote ${OUTPUT_FILE}" >&2
