"""observability configuration and request instrumentation."""

import logging
import re
import warnings
from types import ModuleType
from typing import Any

from fastapi import Request, WebSocket

from backend.config import Settings

# pattern to match plyrfm SDK/MCP user-agent headers
# format: "plyrfm/{version}" or "plyrfm-mcp/{version}"
_PLYRFM_UA_PATTERN = re.compile(r"^plyrfm(-mcp)?/(\d+\.\d+\.\d+)")


def suppress_warnings() -> None:
    """filter pydantic warnings emitted by the atproto library."""
    warnings.filterwarnings(
        "ignore",
        message="The 'default' attribute with value None was provided to the `Field\\(\\)` function",
        category=UserWarning,
        module="pydantic._internal._generate_schema",
    )


def configure_observability(settings: Settings) -> ModuleType | None:
    """configure logfire and logging. returns the logfire module if enabled, else None."""
    if settings.observability.enabled:
        import logfire

        if not settings.observability.write_token:
            raise ValueError(
                "LOGFIRE_WRITE_TOKEN must be set when LOGFIRE_ENABLED is true"
            )

        logfire.configure(
            token=settings.observability.write_token,
            environment=settings.observability.environment,
        )

        # configure logging with logfire handler
        logging.basicConfig(
            level=logging.DEBUG if settings.app.debug else logging.INFO,
            handlers=[logfire.LogfireLoggingHandler()],
        )
    else:
        logfire = None
        # fallback to basic logging when logfire is disabled
        logging.basicConfig(
            level=logging.DEBUG if settings.app.debug else logging.INFO,
            format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
        )

    # reduce noise from verbose loggers
    for logger_name in settings.observability.suppressed_loggers:
        logging.getLogger(logger_name).setLevel(logging.WARNING)

    return logfire


def parse_plyrfm_user_agent(user_agent: str | None) -> dict[str, str]:
    """parse plyrfm SDK/MCP user-agent into span attributes.

    returns dict with:
        - client_type: "sdk", "mcp", or "browser"
        - client_version: version string (only for sdk/mcp)
    """
    if not user_agent:
        return {"client_type": "browser"}

    match = _PLYRFM_UA_PATTERN.match(user_agent)
    if not match:
        return {"client_type": "browser"}

    is_mcp = match.group(1) is not None  # "-mcp" suffix present
    version = match.group(2)

    return {
        "client_type": "mcp" if is_mcp else "sdk",
        "client_version": version,
    }


def request_attributes_mapper(
    request: Request | WebSocket, attributes: dict[str, Any], /
) -> dict[str, Any] | None:
    """extract client metadata from request headers for span enrichment."""
    user_agent = request.headers.get("user-agent")
    return parse_plyrfm_user_agent(user_agent)
