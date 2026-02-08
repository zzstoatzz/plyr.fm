# plyr-redis

self-hosted Redis on Fly.io for docket background tasks.

## deployment

```bash
# first time: create app and volume
fly apps create plyr-redis
fly volumes create redis_data --region iad --size 1 -a plyr-redis

# deploy
fly deploy -a plyr-redis
```

## connecting from other fly apps

Redis is accessible via Fly's private network:

```
redis://plyr-redis.internal:6379
```

Update `DOCKET_URL` secret on backend apps:

```bash
fly secrets set DOCKET_URL=redis://plyr-redis.internal:6379 -a relay-api
fly secrets set DOCKET_URL=redis://plyr-redis.internal:6379 -a relay-api-staging
```

## configuration

- **persistence**: AOF (append-only file) enabled for durability
- **memory**: 200MB max with LRU eviction
- **storage**: 1GB volume mounted at /data

## cost

~$1.94/month (256MB shared-cpu VM) + $0.15/month (1GB volume) = ~$2.09/month

vs. Upstash pay-as-you-go which was costing ~$75/month at 37M commands.
