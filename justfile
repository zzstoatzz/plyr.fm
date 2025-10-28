# relay dev workflows

# show available commands
default:
    @just --list

# run backend server
serve:
    uv run uvicorn relay.main:app --reload --host 0.0.0.0 --port 8000

# run frontend dev server
dev:
    cd frontend && bun run dev
