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
    # symlink AGENTS.md to CLAUDE.md
    ln -s AGENTS.md CLAUDE.md


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

# start dev services (redis)
dev-services:
    docker compose up -d
    @echo "redis running at localhost:6379"

# stop dev services
dev-services-down:
    docker compose down

# expose backend via ngrok tunnel
tunnel:
    ngrok http 8001 --domain tunnel.zzstoatzz.io
