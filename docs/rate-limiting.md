# Rate Limiting

plyr.fm uses [slowapi](https://github.com/laurentS/slowapi) to implement application-side rate limiting. This protects the backend from abuse, brute-force attacks, and denial-of-service attempts.

## Configuration

Rate limits are configured via environment variables. Defaults are set in `src/backend/config.py`.

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `RATE_LIMIT_ENABLED` | `true` | Enable/disable rate limiting globally. |
| `RATE_LIMIT_DEFAULT_LIMIT` | `100/minute` | Global limit applied to all endpoints by default. |
| `RATE_LIMIT_AUTH_LIMIT` | `10/minute` | Strict limit for auth endpoints (`/auth/start`, `/auth/exchange`). |
| `RATE_LIMIT_UPLOAD_LIMIT` | `5/minute` | Strict limit for file uploads (`/tracks/`). |

## Architecture

The current implementation uses **in-memory storage**.

*   **Per-Instance:** Limits are tracked per application instance.
*   **Scaling:** If we run 2 replicas on Fly.io, the *effective* total limit for the cluster is roughly `limit * 2`.
*   **Keying:** Limits are applied by **IP address** (`get_remote_address`).

### Why in-memory?
For our current scale, in-memory is sufficient and avoids the complexity/cost of a dedicated Redis cluster. If we need strict global synchronization in the future, `slowapi` supports Redis backend.

## Adding Limits to Endpoints

To apply a specific limit to a route, use the `@limiter.limit` decorator:

```python
from backend.utilities.rate_limit import limiter
from backend.config import settings

@router.post("/my-expensive-endpoint")
@limiter.limit("5/minute")
async def my_endpoint(request: Request):
    ...
```

**Requirements:**
*   The endpoint function **must** accept a `request: Request` parameter.
*   Use configuration settings instead of hardcoded strings where possible.

## Monitoring

Rate limit hits return `429 Too Many Requests`. These events are logged and will appear in Logfire traces with the `429` status code.
