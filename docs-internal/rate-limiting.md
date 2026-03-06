---
title: "rate limiting"
---

plyr.fm uses [slowapi](https://github.com/laurentS/slowapi) to implement application-side rate limiting. This protects the backend from abuse, brute-force attacks, and denial-of-service attempts.

## Configuration

Rate limits are configured via environment variables. Defaults are set in `src/backend/config.py`.

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `RATE_LIMIT_ENABLED` | `true` | Enable/disable rate limiting globally. |
| `RATE_LIMIT_DEFAULT_LIMIT` | `100/minute` | Global limit applied to all endpoints by default. |
| `RATE_LIMIT_AUTH_LIMIT` | `10/minute` | Strict limit for auth endpoints (`/auth/start`, `/auth/exchange`). |
| `RATE_LIMIT_UPLOAD_LIMIT` | `20/minute` | Strict limit for file uploads (`/tracks/`). |

## Architecture

The implementation uses **Redis-backed storage** via the existing docket Redis instance (`DOCKET_URL`).

*   **Global Counters:** Limits are shared across all application instances (Fly Machines). A `100/minute` limit means 100 requests total, regardless of which machine handles them.
*   **Keying:** Limits are applied by **IP address** (`get_remote_address`).
*   **Fallback:** When `DOCKET_URL` is not set (e.g., local dev without Redis), falls back to in-memory storage automatically.

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
