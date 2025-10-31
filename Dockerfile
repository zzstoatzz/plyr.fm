FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim

# install git for git dependencies
RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# install dependencies
COPY pyproject.toml uv.lock README.md ./
RUN uv sync --frozen --no-dev --no-install-project

# copy application code
COPY src ./src

# install the project itself
RUN uv sync --frozen --no-dev

# expose port
EXPOSE 8000

# run the application
CMD ["uv", "run", "uvicorn", "relay.main:app", "--host", "0.0.0.0", "--port", "8000"]
