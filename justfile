# plyr.fm dev workflows
mod frontend
mod transcoder


# show available commands
default:
    @just --list


# run backend server (hot reloads)
run-backend:
    uv run uvicorn backend.main:app --reload --host 0.0.0.0 --port ${PORT:-8001}

# run tests with docker-compose
test *ARGS='tests/':
    docker compose -f tests/docker-compose.yml up -d
    uv run pytest {{ ARGS }}
    docker compose -f tests/docker-compose.yml down

# run type checking
lint:
    uv run ty check

# create a new database migration
migrate MESSAGE:
    uv run alembic revision --autogenerate -m "{{ MESSAGE }}"

# upgrade database to latest migration
migrate-up:
    uv run alembic upgrade head

# show current migration status
migrate-status:
    uv run alembic current


# show commits since last release
changelog:
    @git log $(git describe --tags --abbrev=0)..HEAD --pretty=format:'%C(yellow)%h%Creset %C(blue)%ad%Creset %C(green)%s%Creset %C(dim)- %an%Creset' --date=relative

# create a github release (triggers production deployment)
release:
    ./scripts/release

# deploy frontend only (promote remote main to production-fe branch)
release-frontend-only:
    git fetch origin main
    git push origin origin/main:production-fe
