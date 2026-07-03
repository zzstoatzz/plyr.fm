---
title: "integration tests"
---

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

CI **mints its tokens just-in-time** and throws them away — no long-lived token is stored, so nothing expires (`SessionExpiredError`) or needs rotating. The `mint JIT dev tokens` step calls `POST /auth/dev-token/app-password` on staging with a stored app-password per account, uses the 1-day token for the run, and revokes it in teardown.

| account | tests |
|--------|---------|
| zzstoatzz.io | primary - all single-user tests |
| plyr.fm | secondary - cross-user interaction tests |
| zzstoatzzdevlog.bsky.social | tertiary - reserved |

### secrets (GitHub Actions)

| secret | what |
|--------|------|
| `APP_PASSWORD_MINT_SECRET` | admin secret for the mint endpoint (also set on staging as `AUTH_APP_PASSWORD_MINT_SECRET`) |
| `PLYR_TEST_APP_PASSWORD_{1,2,3}` | an atproto app-password per account above |

### staging setup (one-time)

The mint endpoint is doubly gated and OFF everywhere by default. Enable it **on staging only**:

```
AUTH_ALLOW_APP_PASSWORD_DEV_TOKENS=true
AUTH_APP_PASSWORD_MINT_SECRET=<same value as the APP_PASSWORD_MINT_SECRET GH secret>
```

Generate each account's app-password once (bsky settings → app passwords, or your PDS) and store as the `PLYR_TEST_APP_PASSWORD_*` secrets. To rotate, replace the app-password — the tokens themselves are ephemeral.

### running locally

`just mint-dev-token --handle <h> --bootstrap` mints a token from an account password (`$MAIN_BSKY_PASSWORD`); pass `--verify` to prove the write path. Or export `PLYR_TEST_TOKEN_{1,2,3}` yourself and run `uv run pytest tests/integration -m integration -v`. See [authentication.md](../authentication.md#browserless-minting-devstaging-test-tokens).

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
