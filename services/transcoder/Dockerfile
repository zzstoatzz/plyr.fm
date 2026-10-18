# syntax=docker/dockerfile:1.7

FROM debian:bookworm-slim AS ffmpeg
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        xz-utils \
        && rm -rf /var/lib/apt/lists/*
RUN mkdir -p /tmp/ffmpeg \
    && curl -L https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz \
        | tar -xJ --strip-components=1 -C /tmp/ffmpeg

FROM rust:1.85-slim AS builder
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    apt-get update && apt-get install -y --no-install-recommends pkg-config libssl-dev \
        && rm -rf /var/lib/apt/lists/*
WORKDIR /app/services/transcoder

# leverage incremental builds by compiling deps first
COPY services/transcoder/Cargo.toml services/transcoder/Cargo.lock ./
RUN mkdir src && echo "fn main() {}" > src/main.rs
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/app/services/transcoder/target \
    cargo build --release
RUN rm -rf src

# now copy actual sources (binary output stored in image layer)
COPY services/transcoder/src ./src
COPY backend/src/backend/upload_contract.json /app/backend/src/backend/upload_contract.json
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    cargo build --release

FROM debian:bookworm-slim
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates \
        libssl3 \
        && rm -rf /var/lib/apt/lists/*

COPY --from=ffmpeg /tmp/ffmpeg/ffmpeg /usr/local/bin/ffmpeg
COPY --from=ffmpeg /tmp/ffmpeg/ffprobe /usr/local/bin/ffprobe
COPY --from=builder /app/services/transcoder/target/release/transcoder /usr/local/bin/transcoder

ENV TRANSCODER_HOST=0.0.0.0 \
    TRANSCODER_PORT=8080

EXPOSE 8080
CMD ["/usr/local/bin/transcoder"]
