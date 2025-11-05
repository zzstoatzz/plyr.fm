#!/usr/bin/env bash
set -euo pipefail

# profile docker build performance
# usage: ./scripts/profile-docker-build.sh [iterations]

ITERATIONS=${1:-3}
IMAGE_NAME="relay-build-profile"
BUILD_LOG="docker-build-profile-$(date +%Y%m%d-%H%M%S).log"

echo "profiling docker build (${ITERATIONS} iterations)..."
echo "results will be saved to ${BUILD_LOG}"
echo ""

# clean up function
cleanup() {
    echo "cleaning up..."
    docker rmi "${IMAGE_NAME}:test" 2>/dev/null || true
}
trap cleanup EXIT

# array to store build times
declare -a build_times
declare -a layer_times

for i in $(seq 1 "${ITERATIONS}"); do
    echo "=== iteration ${i}/${ITERATIONS} ===" | tee -a "${BUILD_LOG}"

    # clear docker build cache between iterations
    if [ "$i" -gt 1 ]; then
        echo "clearing build cache..." | tee -a "${BUILD_LOG}"
        docker builder prune -f > /dev/null 2>&1
    fi

    # build with timing and detailed output
    echo "building..." | tee -a "${BUILD_LOG}"
    START=$(date +%s.%N)

    docker build \
        --progress=plain \
        --no-cache \
        -t "${IMAGE_NAME}:test" \
        . 2>&1 | tee -a "${BUILD_LOG}"

    END=$(date +%s.%N)
    DURATION=$(echo "$END - $START" | bc)
    build_times+=("$DURATION")

    echo "iteration ${i} completed in ${DURATION}s" | tee -a "${BUILD_LOG}"
    echo "" | tee -a "${BUILD_LOG}"
done

# calculate statistics
echo "=== build time summary ===" | tee -a "${BUILD_LOG}"
total=0
for time in "${build_times[@]}"; do
    echo "  ${time}s" | tee -a "${BUILD_LOG}"
    total=$(echo "$total + $time" | bc)
done

avg=$(echo "scale=2; $total / ${ITERATIONS}" | bc)
echo "" | tee -a "${BUILD_LOG}"
echo "average build time: ${avg}s" | tee -a "${BUILD_LOG}"

# extract layer-by-layer timing from last build
echo "" | tee -a "${BUILD_LOG}"
echo "=== layer timing analysis (from last build) ===" | tee -a "${BUILD_LOG}"
grep "DONE" "${BUILD_LOG}" | tail -20 | tee -a "${BUILD_LOG}"

echo ""
echo "detailed logs saved to ${BUILD_LOG}"
