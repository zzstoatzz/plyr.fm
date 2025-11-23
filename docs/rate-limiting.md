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

*   **Per-Instance:** Limits are tracked per application instance (Fly Machine).
*   **Scaling:** With multiple replicas (e.g., 2 machines), the **effective global limit** scales linearly.
    *   Example: A limit of `100/minute` with 2 machines results in a total capacity of roughly `200/minute`.
*   **Keying:** Limits are applied by **IP address** (`get_remote_address`).

### Why in-memory?
For our current scale, in-memory is sufficient and avoids the complexity/cost of a dedicated Redis cluster. This provides effective protection against single-source flooding (DDoS/brute-force) directed at any specific instance.

### Future State (Redis)
If strict global synchronization or complex tier-based limiting is required in the future, we will migrate to a Redis-backed limiter. `slowapi` supports Redis out of the box, which would allow maintaining shared counters across all application instances.

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