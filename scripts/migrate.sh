#!/bin/bash
set -e

echo "running database migrations..."
uv run alembic upgrade head
echo "migrations complete"
