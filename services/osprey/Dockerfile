FROM python:3.11-slim

WORKDIR /app

# install git for pip git deps
RUN apt-get update && apt-get install -y --no-install-recommends git && rm -rf /var/lib/apt/lists/*

# install dependencies
COPY pyproject.toml .
RUN pip install --no-cache-dir .

# copy plugin code and rules
COPY plugin/ plugin/
COPY rules/ rules/

ENV OSPREY_INPUT_STREAM_SOURCE=plugin
ENV OSPREY_STDOUT_OUTPUT_SINK=True
ENV OSPREY_RULES_PATH=/app/rules

# run the Osprey worker
CMD ["osprey-cli", "run-rules-sink", "--no-pooled"]
