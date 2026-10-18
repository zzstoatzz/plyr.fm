"""Read queue progress independently of worker heartbeats."""

from datetime import datetime
from typing import Any

from docket import Docket
from redis.asyncio import Redis

from backend.config import settings

QUEUE_STALE_SECONDS = 120
_QUEUE_PROGRESS = """
local due = redis.call('ZCOUNT', KEYS[1], '-inf', ARGV[1])
local oldest = redis.call('ZRANGE', KEYS[1], 0, 0, 'WITHSCORES')
local first_due = 0
if due > 0 then first_due = tonumber(oldest[2]) end
local cursor = '0-0'
if redis.call('EXISTS', KEYS[2]) == 1 then
    local groups = redis.call('XINFO', 'GROUPS', KEYS[2])
    for _, group in ipairs(groups) do
        local name = ''
        local delivered = '0-0'
        for i = 1, #group, 2 do
            if group[i] == 'name' then name = group[i + 1] end
            if group[i] == 'last-delivered-id' then delivered = group[i + 1] end
        end
        if name == ARGV[2] then cursor = delivered end
    end
end
local ready = redis.call('XRANGE', KEYS[2], '(' .. cursor, '+', 'COUNT', 1)
local first_ready = 0
if #ready > 0 then
    first_ready = tonumber(string.match(ready[1][1], '^(%d+)')) / 1000
end
return {due, tostring(first_due), tostring(first_ready)}
"""


async def worker_progress(now: datetime) -> dict[str, Any]:
    if settings.docket.url.startswith("memory://"):
        return {"status": "ok", "enabled": False}
    docket = Docket(name=settings.docket.name, url=settings.docket.url)
    async with Redis.from_url(settings.docket.url) as redis:
        due, first_due, first_ready = await redis.eval(
            _QUEUE_PROGRESS,
            2,
            docket.queue_key,
            docket.stream_key,
            now.timestamp(),
            docket.worker_group_name,
        )
    timestamps = [float(value) for value in (first_due, first_ready) if float(value)]
    age = max(0, now.timestamp() - min(timestamps)) if timestamps else None
    return {
        "status": "degraded" if age is not None and age > QUEUE_STALE_SECONDS else "ok",
        "enabled": True,
        "overdue_scheduled": due,
        "ready": bool(float(first_ready)),
        "oldest_waiting_age_seconds": int(age) if age is not None else None,
        "stale_after_seconds": QUEUE_STALE_SECONDS,
    }
