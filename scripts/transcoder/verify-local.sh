#!/usr/bin/env bash
set -euo pipefail

# Clean up any previous runs
mkdir -p sandbox/test-files
rm -f sandbox/test-files/test.aiff sandbox/test-files/test.mp3 transcoder_output.log

echo "Building transcoder..."
cd transcoder
cargo build --quiet
cd ..

echo "Starting transcoder..."
export TRANSCODER_PORT=8083
export TRANSCODER_HOST=127.0.0.1
# We use 8083 to avoid conflict with any previous zombies on 8082

./transcoder/target/debug/transcoder > transcoder_output.log 2>&1 &
PID=$!
echo "Transcoder started with PID $PID"

# Cleanup function
cleanup() {
  echo "Stopping transcoder..."
  kill $PID || true
  wait $PID || true
}
trap cleanup EXIT

# Wait for health check
echo "Waiting for transcoder to be ready..."
for i in {1..30}; do
  if curl -s "http://127.0.0.1:8083/health" > /dev/null; then
    echo "Transcoder is ready!"
    break
  fi
  sleep 0.5
done

if ! curl -s "http://127.0.0.1:8083/health" > /dev/null; then
  echo "Transcoder failed to start. Log output:"
  cat transcoder_output.log
  exit 1
fi

echo "Generating sample AIFF..."
uv run scripts/generate_audio_sample.py sandbox/test-files/test.aiff --waveform sine --duration 2

echo "Testing transcoding..."
# Override port for the test script
export TRANSCODER_PORT=8083
./scripts/transcoder/test-local.sh sandbox/test-files/test.aiff sandbox/test-files/test.mp3

# test-local.sh doesn't append .mp3 if output file is provided
if [[ -f sandbox/test-files/test.mp3 ]]; then
  SIZE=$(wc -c < sandbox/test-files/test.mp3)
  echo "Success! generated MP3 size: $SIZE bytes"
else
  echo "Failure! MP3 file not created."
  exit 1
fi
