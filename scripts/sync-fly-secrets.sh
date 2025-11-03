#!/usr/bin/env bash
# sync secrets from .env to fly.io

set -e

ENV_FILE=".env"

if [ ! -f "$ENV_FILE" ]; then
    echo "error: $ENV_FILE not found"
    exit 1
fi

# extract secrets we want to sync
SECRETS=(
    "LOGFIRE_ENABLED"
    "LOGFIRE_WRITE_TOKEN"
    "NOTIFY_ENABLED"
    "NOTIFY_RECIPIENT_HANDLE"
    "NOTIFY_BOT_HANDLE"
    "NOTIFY_BOT_PASSWORD"
)

# build fly secrets set command
CMD="fly secrets set"

for secret in "${SECRETS[@]}"; do
    # extract value from .env (handles quotes and comments)
    value=$(grep "^${secret}=" "$ENV_FILE" | cut -d '=' -f2- | sed 's/^["'\'']//' | sed 's/["'\'']$//')

    if [ -n "$value" ]; then
        CMD="$CMD ${secret}=\"${value}\""
    fi
done

echo "syncing secrets to fly.io..."
eval "$CMD"
echo "✓ secrets synced"
