# syntax=docker/dockerfile:1.4
FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim

# install git for git dependencies (needed for atproto fork)
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    apt-get update && apt-get install -y git

WORKDIR /app

# install dependencies (separate layer for better caching)
# COPY paths are relative to the build context (root)
COPY backend/pyproject.toml backend/uv.lock README.md ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev --no-install-project --compile-bytecode

# copy application code
COPY backend/src ./src

# copy alembic migration files
COPY backend/alembic.ini .
COPY backend/alembic ./alembic

# install the project itself with bytecode compilation
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev --compile-bytecode

# expose port
EXPOSE 8000

# run the application
CMD ["uv", "run", "uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000"]