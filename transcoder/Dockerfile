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

FROM rust:1.81-slim AS builder
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    apt-get update && apt-get install -y --no-install-recommends pkg-config libssl-dev \
        && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# leverage incremental builds by compiling deps first
COPY Cargo.toml Cargo.lock ./
RUN mkdir src && echo "fn main() {}" > src/main.rs
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/app/target \
    cargo build --release
RUN rm -rf src

# now copy actual sources (binary output stored in image layer)
COPY src ./src
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
COPY --from=builder /app/target/release/transcoder /usr/local/bin/transcoder

ENV TRANSCODER_HOST=0.0.0.0 \
    TRANSCODER_PORT=8080 \
    TRANSCODER_MAX_UPLOAD_BYTES=536870912

EXPOSE 8080
CMD ["/usr/local/bin/transcoder"]
