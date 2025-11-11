#!/usr/bin/env python3
"""run a specific migration against production database."""

import os
import subprocess
import sys
from pathlib import Path

from dotenv import load_dotenv


def main():
    """run alembic upgrade head against production."""
    # load .env file
    env_file = Path(__file__).parent.parent / ".env"
    if not env_file.exists():
        print("❌ .env file not found")
        sys.exit(1)

    load_dotenv(env_file)

    admin_db_url = os.getenv("ADMIN_DATABASE_URL")
    if not admin_db_url:
        print("❌ ADMIN_DATABASE_URL not found in .env")
        sys.exit(1)

    print("🔄 running migration against production database...")

    # set DATABASE_URL to admin url for migration
    env = os.environ.copy()
    env["DATABASE_URL"] = admin_db_url

    try:
        result = subprocess.run(
            ["uv", "run", "alembic", "upgrade", "head"],
            check=True,
            capture_output=True,
            text=True,
            env=env,
        )

        print("✅ migration completed successfully")
        print("\noutput:")
        print(result.stdout)

        if result.stderr:
            print("\nstderr:")
            print(result.stderr)

    except subprocess.CalledProcessError as e:
        print("❌ migration failed")
        print("\nstdout:")
        print(e.stdout)
        print("\nstderr:")
        print(e.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
