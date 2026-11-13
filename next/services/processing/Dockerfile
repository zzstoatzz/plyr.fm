# syntax=docker/dockerfile:1.7
# Build context: next/services/processing

FROM mwader/static-ffmpeg:7.0.2@sha256:d9b22f65c2049d73bf8ae556bb4c5c7d45e9fb85939d87951ed98f22b0f19105 AS ffmpeg

FROM rust:1.85-slim AS builder
WORKDIR /app

# compile dependencies first so source edits rebuild only this crate
COPY Cargo.toml Cargo.lock ./
RUN mkdir src && echo "fn main() {}" > src/main.rs
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/app/target \
    cargo build --release
RUN rm -rf src

COPY src ./src
COPY --from=ffmpeg /ffmpeg /usr/local/bin/ffmpeg
COPY --from=ffmpeg /ffprobe /usr/local/bin/ffprobe
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    cargo test --release && cargo build --release

FROM debian:bookworm-slim
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    apt-get update && apt-get install -y --no-install-recommends ca-certificates \
        && rm -rf /var/lib/apt/lists/*

COPY --from=ffmpeg /ffmpeg /usr/local/bin/ffmpeg
COPY --from=ffmpeg /ffprobe /usr/local/bin/ffprobe
COPY --from=builder /app/target/release/next-processing /usr/local/bin/next-processing

ENV HOST=0.0.0.0 \
    PORT=8080

EXPOSE 8080
CMD ["/usr/local/bin/next-processing"]
