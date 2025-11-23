import asyncio
import sys
import time

import httpx

BASE_URL = "https://api-stg.plyr.fm"


async def check_health(client):
    print(f"Checking {BASE_URL}/health...")
    try:
        resp = await client.get(f"{BASE_URL}/health")
        if resp.status_code == 200:
            print("✅ Health check passed")
        else:
            print(f"❌ Health check failed: {resp.status_code}")
            sys.exit(1)
    except Exception as e:
        print(f"❌ Connection failed: {e}")
        sys.exit(1)


async def verify_rate_limit(client):
    print("\nVerifying rate limits (target: >100 reqs)...")
    # Global limit is 100/min per instance.
    # With N instances, capacity is N * 100.
    count = 250
    rate_limited = 0
    success = 0

    start = time.time()
    # Send in batches
    batch_size = 50
    for _ in range(0, count, batch_size):
        tasks = []
        for _ in range(batch_size):
            tasks.append(client.get(f"{BASE_URL}/health"))

        responses = await asyncio.gather(*tasks, return_exceptions=True)

        for r in responses:
            if isinstance(r, httpx.Response):
                if r.status_code == 429:
                    rate_limited += 1
                elif r.status_code == 200:
                    success += 1
                else:
                    print(f"Unexpected status: {r.status_code}")
            else:
                print(f"Request error: {r}")

        if rate_limited > 0:
            print(f"Hit limit after {success + rate_limited} requests!")
            break

    duration = time.time() - start
    print(f"Summary: {success} OK, {rate_limited} Limited in {duration:.2f}s")

    if rate_limited > 0:
        print("✅ Rate limiting confirmed active")
    else:
        print("⚠️ No rate limits hit - capacity might be higher than tested")


async def main():
    async with httpx.AsyncClient(timeout=10.0) as client:
        await check_health(client)
        await verify_rate_limit(client)


if __name__ == "__main__":
    asyncio.run(main())
