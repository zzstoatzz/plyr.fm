# syntax=docker/dockerfile:1.7

FROM --platform=$TARGETPLATFORM debian:bookworm-slim AS builder

ARG ZIG_VERSION=0.17.0
ARG TARGETARCH

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl libc6-dev libssl-dev python3 \
    && rm -rf /var/lib/apt/lists/*

# Zig 0.17.0 comes from the PyPI `ziglang` wheel, which repackages the official
# release binaries. The wheel is pinned by sha256 and unpacked without pip.
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

COPY build.zig build.zig.zon upload_contract.json ./
COPY --chmod=755 scripts/fetch-interop-fixtures scripts/fetch-interop-fixtures
RUN --mount=type=cache,target=/root/.cache/zig \
    scripts/fetch-interop-fixtures && zig build -Dupload_contract=upload_contract.json --fetch=all

COPY src/ src/
RUN --mount=type=cache,target=/root/.cache/zig \
    --mount=type=cache,target=/build/.zig-cache \
    zig build -Dupload_contract=upload_contract.json -Doptimize=ReleaseSafe -Dcpu=baseline

FROM --platform=$TARGETPLATFORM debian:bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates libssl3 \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /build/zig-out/bin/plyr-backend /usr/local/bin/plyr-backend
COPY --chmod=755 scripts/canary-resource-snapshot /usr/local/bin/canary-resource-snapshot

EXPOSE 8000
ENTRYPOINT ["/usr/local/bin/plyr-backend"]
