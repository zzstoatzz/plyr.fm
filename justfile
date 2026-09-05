# plyr.fm dev workflows
mod frontend
mod backend
mod transcoder 'services/transcoder'
mod moderation 'services/moderation'
mod docs 'docs/site'


# show available commands
default:
    @just --list

# verify shared agent entrypoints (symlinks are checked into git)
setup:
    test -L AGENTS.md && test -f AGENTS.md
    test -L CLAUDE.md && test -f CLAUDE.md
    test -d .agents/skills
    for skill in .agents/skills/*; do test -L ".claude/skills/$(basename "$skill")" && test -f ".claude/skills/$(basename "$skill")/SKILL.md" || exit 1; done


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

# raise loq line limit for files that exceed it
loq-relax *FILES:
    uvx loq relax {{ FILES }}

# expose backend via ngrok tunnel
tunnel:
    ngrok http 8001 --domain tunnel.zzstoatzz.io

# mint a browserless dev token from an app-password (see scripts/mint_dev_token.py)
mint-dev-token *ARGS:
    uv run --project backend scripts/mint_dev_token.py {{ ARGS }}

# offline schema guard; the fixed dummy key is only for importing route definitions
check-client-contract:
    OAUTH_ENCRYPTION_KEY=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA= uv run --directory backend python ../scripts/check_client_contract.py
