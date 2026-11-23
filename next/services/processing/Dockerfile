# syntax=docker/dockerfile:1.7
# Build context: next/services/processing

FROM mwader/static-ffmpeg:7.0.2@sha256:d9b22f65c2049d73bf8ae556bb4c5c7d45e9fb85939d87951ed98f22b0f19105 AS ffmpeg

FROM --platform=$TARGETPLATFORM debian:bookworm-slim AS builder

ARG ZIG_VERSION=0.17.0
ARG TARGETARCH

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl libc6-dev python3 \
    && rm -rf /var/lib/apt/lists/*

# Zig 0.17.0 from the PyPI `ziglang` wheel (the official release binaries),
# pinned by sha256 and unpacked without pip; the same pin as next/backend.
RUN set -eux; \
    case "${TARGETARCH}" in \
        amd64) wheel=ziglang-${ZIG_VERSION}-py3-none-manylinux_2_12_x86_64.manylinux2010_x86_64.musllinux_1_1_x86_64.whl; wheel_sha256=97079827064a7492cce5541ceb438ae8003ce1e54e399676da2d62fb7a5dc08b ;; \
        arm64) wheel=ziglang-${ZIG_VERSION}-py3-none-manylinux_2_17_aarch64.manylinux2014_aarch64.musllinux_1_1_aarch64.whl; wheel_sha256=d2804f94f54f7fcf8169f4b212a619ad688a4e2e6592e976f0cf2e58e2cd8af3 ;; \
        *) echo "unsupported target architecture: ${TARGETARCH}" >&2; exit 1 ;; \
    esac; \
    curl -fsSL "https://files.pythonhosted.org/packages/py3/z/ziglang/${wheel}" -o /tmp/zig.whl; \
    echo "${wheel_sha256}  /tmp/zig.whl" | sha256sum --check -; \
    python3 -c "import zipfile; zipfile.ZipFile('/tmp/zig.whl').extractall('/tmp/zigwheel')"; \
    mv /tmp/zigwheel/ziglang /opt/zig; \
    chmod +x /opt/zig/zig; \
    rm -rf /tmp/zig.whl /tmp/zigwheel

ENV PATH=/opt/zig:$PATH
ENV ZIG_GLOBAL_CACHE_DIR=/root/.cache/zig
WORKDIR /build

# dependencies first, so source edits do not refetch them
COPY build.zig build.zig.zon ./
RUN --mount=type=cache,target=/root/.cache/zig zig build --fetch=all

# the tests run here against the same static ffmpeg the image ships
COPY --from=ffmpeg /ffmpeg /usr/local/bin/ffmpeg
COPY --from=ffmpeg /ffprobe /usr/local/bin/ffprobe
COPY src/ src/
RUN --mount=type=cache,target=/root/.cache/zig \
    --mount=type=cache,target=/build/.zig-cache \
    zig build test && zig build -Doptimize=ReleaseSafe -Dcpu=baseline

FROM debian:bookworm-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY --from=ffmpeg /ffmpeg /usr/local/bin/ffmpeg
COPY --from=ffmpeg /ffprobe /usr/local/bin/ffprobe
COPY --from=builder /build/zig-out/bin/next-processing /usr/local/bin/next-processing

ENV HOST=0.0.0.0 \
    PORT=8080

EXPOSE 8080
CMD ["/usr/local/bin/next-processing"]
