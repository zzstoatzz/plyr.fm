# plyr.fm dev workflows

# show available commands
default:
    @just --list

# run backend server
run-backend:
    uv run uvicorn backend.main:app --reload --host 0.0.0.0 --port ${PORT:-8001}

# run frontend dev server
run-frontend:
    cd frontend && bun run dev

# run tests with docker-compose
test:
    docker compose -f tests/docker-compose.yml up -d
    uv run pytest tests/
    docker compose -f tests/docker-compose.yml down


# deploy frontend to cloudflare pages
deploy-frontend:
    cd frontend && bun run build && bun x wrangler pages deploy .svelte-kit/cloudflare

# create a github release (triggers production deployment)
release:
    ./scripts/release
