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

# deploy backend to fly.io
deploy-backend:
    flyctl deploy

# deploy frontend to cloudflare pages
deploy-frontend:
    cd frontend && bun run build && bun x wrangler pages deploy .svelte-kit/cloudflare
