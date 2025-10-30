# relay dev workflows

# show available commands
default:
    @just --list

# run backend server
serve:
    uv run uvicorn relay.main:app --reload --host 0.0.0.0 --port ${PORT:-8001}

# run frontend dev server
dev:
    cd frontend && bun run dev
