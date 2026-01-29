# PDS blob storage research

storing audio on user's PDS instead of (or in addition to) R2.

## motivation

user feedback: storing audio on R2 diverges from ATProto ideals. users should own their data on their PDS.

proposed pattern:
1. user's PDS: store audio blob + user-owned record
2. service repo: record with CDN URL that references user's PDS blob via at-uri/strongRef
3. CDN: still use for streaming performance

benefits:
- data ownership (canonical audio in user's PDS)
- takedown capability (remove service record, audio stops appearing)
- CDN flexibility (can migrate without breaking tracks)
- protocol-native (explicit verifiable relationship)

## bluesky PDS implementation

repo: `bluesky-social/atproto` (packages/pds)

### blob upload limit

| source | value |
|--------|-------|
| code default | 5MB (`5 * 1024 * 1024`) |
| sample.env recommendation | 100MB (`104857600`) |
| bluesky.social hosted | unknown (likely 100MB) |

config: `PDS_BLOB_UPLOAD_LIMIT` env var

location: `packages/pds/src/config/config.ts`
```typescript
blobUploadLimit: env.blobUploadLimit ?? 5 * 1024 * 1024, // 5mb
```

### limit discovery

**there is no API to discover the blob limit.**

`com.atproto.server.describeServer` returns:
- did
- availableUserDomains
- inviteCodeRequired
- links (privacyPolicy, termsOfService)
- contact email

it does NOT expose blobUploadLimit.

location: `packages/pds/src/api/com/atproto/server/describeServer.ts`

### error when limit exceeded

error type: `ResponseType.PayloadTooLarge`
message: `"request entity too large"`

location: `packages/xrpc-server/src/util.ts`

checks both:
1. content-length header (early rejection)
2. streaming body size (MaxSizeChecker)

## custom PDS implementations

(to be documented as we encounter them)

### tangled.sh PDS

TODO: investigate limits

### other implementations

TODO

## upstream issues (bluesky-social/atproto)

### #1555 → discussion #1582 - Extend describeServer

requested adding blob limits to describeServer. converted to discussion.

**bnewbold's response (Sept 2023):**
- application-specific constraints belong in **Lexicons**, not describeServer
- blob sizes and mime types should be defined at the application level
- rate limits should use HTTP headers
- future endpoint for account-specific resource quotas "we don't have a plan/proposal for this yet"

**implication for plyr.fm:** we can define max audio size in our lexicon, but we can't discover the PDS's actual blob limit. the only option is try-and-catch.

link: https://github.com/bluesky-social/atproto/discussions/1582

### #1737 - Consider raising the size limit of blobs (CLOSED)

from 2023, complained about ~1MB limit. closed as "COMPLETED" - limit was raised (now 100MB in sample.env).

### #3392 - Add restrictions on blobstore consumption (OPEN)

requesting total blob quota per account (not just per-blob limit). mentions:
- ATFile using PDS as file storage
- GrayHaze video streaming experiment
- growing interest in media-heavy apps

### #4009 - bump PDS JSON request limit to 1MB (OPEN PR)

about record size, not blob size. but shows active work on limits.

## production file size analysis (2026-01-29)

bucket: `audio-prod`, 570 files total

| threshold | count | % of total |
|-----------|-------|------------|
| > 100MB | 10 | 1.8% |
| > 50MB | 26 | 4.6% |
| > 25MB | 45 | 7.9% |
| > 10MB | 218 | 38% |
| > 5MB | 447 | 78% |

largest file: 775MB (WAV)

**implications:**
- with 100MB limit (sample.env recommendation): 10 files need R2 fallback
- with 5MB limit (code default): 447 files (78%) need R2 fallback
- WAV files tend to be largest (lossless uploads for export)

## open questions

1. should we try PDS upload and catch PayloadTooLarge, or use a conservative threshold?
2. what's the actual limit on bluesky.social hosted PDSes? (likely 100MB based on sample.env)
3. should we propose re-opening #1555 to add blobUploadLimit to describeServer?

## related

- issue #614: S3-compatible blob sidecar discussion
- issue #146: content-addressable storage
- ATProto discourse: [Media PDS/Service](https://discourse.atprotocol.community/t/media-pds-service/297)
