# syntax=docker/dockerfile:1.7

FROM --platform=$TARGETPLATFORM debian:bookworm-slim AS builder

ARG ZIG_VERSION=0.16.0
ARG TARGETARCH

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl libc6-dev libssl-dev xz-utils \
    && rm -rf /var/lib/apt/lists/*

RUN set -eux; \
    case "${TARGETARCH}" in \
        amd64) zig_arch=x86_64; zig_sha256=70e49664a74374b48b51e6f3fdfbf437f6395d42509050588bd49abe52ba3d00 ;; \
        arm64) zig_arch=aarch64; zig_sha256=ea4b09bfb22ec6f6c6ceac57ab63efb6b46e17ab08d21f69f3a48b38e1534f17 ;; \
        *) echo "unsupported target architecture: ${TARGETARCH}" >&2; exit 1 ;; \
    esac; \
    curl -fsSL "https://ziglang.org/download/${ZIG_VERSION}/zig-${zig_arch}-linux-${ZIG_VERSION}.tar.xz" -o /tmp/zig.tar.xz; \
    echo "${zig_sha256}  /tmp/zig.tar.xz" | sha256sum --check -; \
    mkdir -p /opt/zig; \
    tar -xJf /tmp/zig.tar.xz -C /opt/zig --strip-components=1; \
    rm /tmp/zig.tar.xz

ENV PATH=/opt/zig:$PATH
ENV ZIG_GLOBAL_CACHE_DIR=/root/.cache/zig
WORKDIR /build

COPY build.zig build.zig.zon ./
RUN --mount=type=cache,target=/root/.cache/zig \
    zig build --fetch=all

COPY src/ src/
RUN --mount=type=cache,target=/root/.cache/zig \
    --mount=type=cache,target=/build/.zig-cache \
    zig build -Doptimize=ReleaseSafe -Dcpu=baseline

FROM --platform=$TARGETPLATFORM debian:bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates libssl3 \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /build/zig-out/bin/plyr-backend /usr/local/bin/plyr-backend

EXPOSE 8000
ENTRYPOINT ["/usr/local/bin/plyr-backend"]
