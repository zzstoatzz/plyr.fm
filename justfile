# relay justfile - common dev workflows

# default recipe shows all available commands
default:
    @just --list

# ====================
# backend (python/fastapi)
# ====================

# install python dependencies
install:
    uv sync

# run backend dev server
serve:
    uv run uvicorn relay.main:app --reload --host 0.0.0.0 --port 8000

# run pre-commit hooks
lint:
    uv run pre-commit run --all-files

# run python tests
test:
    uv run pytest

# type check python code
typecheck:
    uv run pyright

# ====================
# frontend (sveltekit)
# ====================

# install frontend dependencies
[group('frontend')]
fe-install:
    cd frontend && npm install

# run frontend dev server
[group('frontend')]
fe-dev:
    cd frontend && npm run dev

# build frontend for production
[group('frontend')]
fe-build:
    cd frontend && npm run build

# preview production frontend build
[group('frontend')]
fe-preview:
    cd frontend && npm run preview

# check frontend types and svelte errors
[group('frontend')]
fe-check:
    cd frontend && npm run check

# lint frontend code
[group('frontend')]
fe-lint:
    cd frontend && npm run lint

# format frontend code
[group('frontend')]
fe-format:
    cd frontend && npm run format

# run frontend tests
[group('frontend')]
fe-test:
    cd frontend && npm run test

# ====================
# database
# ====================

# delete database (requires fresh start)
db-reset:
    rm -f data/relay.db
    @echo "database deleted - will be recreated on next server start"

# ====================
# development
# ====================

# run both backend and frontend in parallel
dev:
    #!/usr/bin/env bash
    trap 'kill 0' EXIT
    just serve &
    just fe-dev &
    wait

# format all code (python + frontend)
format: fe-format
    uv run ruff format .

# check everything (lint + typecheck + test)
check: lint typecheck fe-check fe-lint test fe-test
    @echo "✓ all checks passed"

# clean all generated files
clean:
    rm -rf frontend/node_modules frontend/.svelte-kit frontend/build
    rm -rf .venv
    rm -f data/relay.db
    @echo "cleaned all generated files"
