FROM rust:1.96-bookworm AS builder
RUN apt-get update && apt-get install -y --no-install-recommends git pkg-config libssl-dev ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ARG RADIO_REVISION=62d63eb2795a21e8290cd4191f0b6fcbcc49cdaa
RUN git clone https://tangled.org/zzstoatzz.io/plyr-radio . && git checkout "$RADIO_REVISION"
RUN cargo test --locked && cargo build --release --locked

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates libssl3 && rm -rf /var/lib/apt/lists/* && useradd -m -u 10001 -s /usr/sbin/nologin radio
WORKDIR /app
COPY --from=builder /app/target/release/radio /app/radio
RUN mkdir -p /app/data/audio && chown -R radio:radio /app
ENTRYPOINT ["/bin/sh", "-c", "chown -R radio:radio /app/data && exec runuser -u radio -- /app/radio"]
