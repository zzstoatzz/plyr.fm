# integration tests

integration tests run against the staging environment (`api-stg.plyr.fm`) using real API tokens.

## running locally

```bash
# set tokens
export PLYR_TEST_TOKEN_1=...
export PLYR_TEST_TOKEN_2=...
export PLYR_TEST_TOKEN_3=...

# run tests
cd backend
uv run pytest tests/integration -m integration -v
```

## test accounts

| secret | handle | purpose |
|--------|--------|---------|
| `PLYR_TEST_TOKEN_1` | zzstoatzz.io | primary test user - all single-user tests |
| `PLYR_TEST_TOKEN_2` | plyr.fm | secondary user - cross-user interaction tests |
| `PLYR_TEST_TOKEN_3` | zzstoatzzdevlog.bsky.social | tertiary user - reserved for future tests |

tokens are developer tokens created at [plyr.fm/portal](https://plyr.fm/portal) → "developer tokens".

## github actions

the `integration-tests.yml` workflow runs automatically after staging deployment succeeds. it can also be triggered manually via workflow dispatch.

secrets are stored in the repository settings under Settings → Secrets and variables → Actions.

## test structure

```
backend/tests/integration/
├── conftest.py              # fixtures, multi-user auth
├── test_track_lifecycle.py  # upload, edit, delete (5 tests)
├── test_interactions.py     # cross-user likes, permissions (4 tests)
└── utils/
    └── audio.py             # pure python drone generation
```

## adding new tests

1. use the `user1_client`, `user2_client`, or `user3_client` fixtures
2. tag all test content with `integration-test` for identification
3. always clean up in a `finally` block
4. use `pytest.mark.integration` and `pytest.mark.timeout(120)`

example:

```python
async def test_something(user1_client: AsyncPlyrClient, drone_a4: Path):
    result = await user1_client.upload(drone_a4, "Test", tags={"integration-test"})
    track_id = result.track_id

    try:
        # test logic here
        pass
    finally:
        await user1_client.delete(track_id)
```

## audio generation

tests use pure python WAV generation (no FFmpeg required):

```python
from tests.integration.utils.audio import generate_drone, save_drone

# generate in memory
wav = generate_drone("A4", duration_sec=2.0)  # 440Hz, ~22KB

# save to file
save_drone(Path("/tmp/drone.wav"), "E4", duration_sec=1.0)
```

available notes: C3-B4, A5 (standard A440 tuning).
