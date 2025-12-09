# plyr.fm dev workflows
mod frontend
mod transcoder
mod moderation
mod backend


# show available commands
default:
    @just --list

# get setup
setup:
    # symlink AGENTS.md to CLAUDE.md and GEMINI.md
    ln -s AGENTS.md CLAUDE.md
    ln -s AGENTS.md GEMINI.md

    # Setup sub-modules if they have setup recipes
    # just frontend setup # Uncomment if frontend/justfile gets a setup
    # just backend setup # Uncomment if backend/justfile gets a setup


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

# start dev services (redis for background tasks)
dev-up:
    docker compose up -d
    @echo "redis running at localhost:6379"
    @echo "set DOCKET_URL=redis://localhost:6379 to enable docket"

# stop dev services
dev-down:
    docker compose down

# start full dev environment (services + backend + frontend)
dev:
    docker compose up -d
    @echo "starting backend and frontend..."
    @echo "redis: localhost:6379"
    @echo "set DOCKET_URL=redis://localhost:6379 to enable docket"
    @just backend run &
    @just frontend dev
