"""Provider quota evidence safe to retain in orchestration errors."""

import re

import httpx


class AudioProviderError(RuntimeError):
    def __init__(self, status: int, quotas: tuple[str, ...] = ()) -> None:
        self.status = status
        self.quotas = quotas
        super().__init__(status, quotas)

    @property
    def daily_quota_exhausted(self) -> bool:
        return self.status == 429 and any("PerDay" in quota for quota in self.quotas)

    def __str__(self) -> str:
        detail = f"; quotas: {', '.join(self.quotas)}" if self.quotas else ""
        return f"Audio review HTTP {self.status}{detail}; no text fallback"

    @classmethod
    def from_response(cls, response: httpx.Response) -> "AudioProviderError":
        try:
            body = response.json()
        except ValueError:
            return cls(response.status_code)
        error = body.get("error") if isinstance(body, dict) else None
        details = error.get("details") if isinstance(error, dict) else None
        quotas = []
        for detail in details if isinstance(details, list) else []:
            if not isinstance(detail, dict) or detail.get("@type") != (
                "type.googleapis.com/google.rpc.QuotaFailure"
            ):
                continue
            violations = detail.get("violations")
            for violation in violations if isinstance(violations, list) else []:
                if not isinstance(violation, dict):
                    continue
                quota = violation.get("quotaId")
                value = violation.get("quotaValue")
                if isinstance(quota, str) and re.fullmatch(
                    r"[A-Za-z0-9_-]{1,160}", quota
                ):
                    limit = (
                        f"={value}"
                        if isinstance(value, str) and value.isdecimal()
                        else ""
                    )
                    quotas.append(quota + limit)
        return cls(response.status_code, tuple(quotas))
