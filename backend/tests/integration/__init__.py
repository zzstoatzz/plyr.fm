"""integration tests for plyr.fm API.

these tests run against a real staging environment and require:
- PLYR_TEST_TOKEN_1, PLYR_TEST_TOKEN_2, PLYR_TEST_TOKEN_3 env vars
- staging API at https://api-stg.plyr.fm (or PLYR_API_URL override)

run with: uv run pytest tests/integration -m integration -v
"""
