# what a session cache does to credentials

*August 8, 2026 — written after #1778–#1784, which closed a live credential exposure in plyr.fm's session cache.*

This note is about a class of bug rather than the bug we had. We fixed ours; the shape is general enough that other ATProto appviews doing OAuth are worth checking against it, and one part of it is specific to ATProto in a way that is easy to miss.

We audited only plyr.fm. Nothing here is a claim about any other project's code.

## the specific thing we found

plyr.fm encrypts OAuth session data at rest. `user_sessions.oauth_session_data` is a Fernet blob; the key lives in settings and the module refuses to import without it. That control was real and worked.

Then `get_session()` decrypted that blob and wrote the result into Redis for 60 seconds on every cache miss, as plain JSON, keyed by the session id. Redis required no authentication. So the encryption boundary that Postgres respected ended one function call later, and the plaintext sat in a datastore reachable by anything on the private network.

Three separate mistakes stacked in about fifteen lines:

1. **The cached value was plaintext.** The ciphertext was already in hand at the point of the cache write — we decrypted it, used it, and then cached the decrypted form rather than the thing we already had.
2. **The cache key was the credential.** `plyr:session:<session_id>`, where `session_id` is the bearer token. A `KEYS plyr:session:*` scan enumerated live credentials without reading a single value.
3. **The cached value repeated the credential** in a `session_id` field, which was redundant — the caller already knew the id it looked up by.

## why "encrypted at rest" didn't cover it

Encryption-at-rest gets scoped to the database, because the database is where you think data lives. A cache feels like a different category — ephemeral, internal, an implementation detail of a read path. It isn't. It is a datastore with a copy of your data and, usually, weaker access controls than the database it fronts.

The tell is structural: if you can point at code that decrypts a secret and then hands it to something that persists it, the encryption is decorative past that line. Worth grepping your own codebase for a decrypt call whose result flows into a `set`, a `dumps`, a log call, or a metric label.

The fix is not complicated — cache the ciphertext you already have and decrypt on read. Cost is one symmetric decrypt per cache hit, which is nothing next to the round trip you avoided.

## the ATProto-specific part: DPoP keys are not "just session data"

This is the part worth a second look in any ATProto OAuth client.

ATProto OAuth uses DPoP, so every session carries a per-session private key. Ours lived in the same session dict as the tokens, under `dpop_private_key_pem`, and was therefore cached in plaintext alongside them.

DPoP exists precisely so that a stolen access token is not sufficient. It is proof-of-possession: the token is bound to a key the client holds, and a thief without the key cannot mint valid proofs. Storing the private key next to the token it protects collapses DPoP back to bearer semantics — an attacker who reads that one cache entry has the token, the refresh token, *and* the key, which is everything needed to make authenticated writes to the user's PDS.

What makes this easy to miss is naming. You audit for "tokens," you encrypt the things called `access_token` and `refresh_token`, and the DPoP key rides along in the same structure without ever being classified as a credential — even though it is the one that makes the others hard to use. If you handle it as an opaque field of the session blob, it inherits whatever protection the blob gets, which was our case exactly.

Concretely, worth checking in an ATProto appview:

- Is the DPoP private key encrypted everywhere the tokens are, including caches, backups, and debug dumps?
- Does it appear in logs? Session objects get logged whole more often than tokens do, because they read as "context" rather than "secret."
- Does it cross a service boundary in plaintext — into a queue payload, a task argument, a trace attribute?

Our answer to the first was "no, in the cache." We had not asked the other two before this audit; they were clean, but by luck of structure rather than by design.

## secrets do not belong in names

The cache-key mistake generalizes past caches. A credential used as a *name* — a Redis key, a URL path segment, a filename, a metric label, a span attribute, a queue name — is exposed to every mechanism that enumerates names, and those mechanisms are usually treated as non-sensitive. `KEYS`, a directory listing, a metrics scrape, an access log, a trace UI.

Hash it. `sha256(credential)` as the key is stable, is the same length, and costs nothing. We also found three `logger.debug` calls printing full session ids where the rest of the codebase truncated to eight characters — the inconsistency is the interesting part, because it means the convention existed and was simply not applied everywhere.

## the reason any of this mattered: chaining

None of the above is dramatic alone. An unauthenticated internal Redis is "internal." A media transcoder that accepts all requests when its auth token is unset is "misconfiguration only." A cache holding plaintext is "you'd need access first."

The OpenAI agent-swarm incident published this month is a good corrective. Hugging Face's forensic reconstruction covers roughly 17,600 attacker actions between July 9–13, and JFrog confirmed the escape route was a self-hosted Artifactory with eight zero-days. The interesting part is not any single vulnerability — it is that SSRF to reach the network, then RCE, then a kernel escalation, then instance metadata, then cluster credentials composed into something none of them were individually.

Read that way, our own findings rearranged themselves. The publicly-reachable transcoder that fails open, the media parser eating untrusted bytes, the shared private network, and the unauthenticated Redis holding decrypted DPoP keys are not four small issues — they are four steps, and only the last one is the payoff. That reframing is what moved the Redis cache from "hardening" to "fix tonight."

The generalizable version: **an unauthenticated datastore on a shared private network is a severity multiplier for every other bug you have.** Fly's 6PN, a Kubernetes cluster network, and a Docker bridge are all org- or cluster-scoped rather than per-app. "Only reachable internally" describes a wall around a neighbourhood, not around your house.

## a note on verifying fixes

We verified this one by connecting to the actual Redis in both environments and asserting on real cache entries — key shape, absence of the bearer token in key and value, `oauth_session` being ciphertext, no plaintext `access_token` / `refresh_token` / `dpop_private_key_pem`. Before the release, production failed every one of those checks; after, it passed all of them.

That mattered more than it sounds. A green test suite proves the code does what the test says. It does not prove the deployed system holds what you think it holds, and for a caching change the failure modes are quiet: a cache key that is unstable across calls "works" while silently never hitting, and a fix that logs the user out on an unreadable entry looks fine until an OAuth key rotation. Our own regression test caught that second one — the first implementation returned `None` on a decrypt failure, which would have made a key rotation a mass logout and let anyone with Redis write access force-logout users at will.

## checklist

For an ATProto appview holding OAuth sessions:

- [ ] Does anything cache, queue, or log the decrypted session payload?
- [ ] Is the DPoP private key protected everywhere the tokens are?
- [ ] Is any credential used as a key, path, filename, or label?
- [ ] Does every internal datastore require authentication, or does it rely on network position?
- [ ] Does any internal service accept requests when its auth secret is unset?
- [ ] For each security issue you closed as done — was it verified against the running system, or against the diff?

That last one is not rhetorical. We closed an issue in February whose summary claimed "CORS validation"; the shipped regex permits every HTTPS origin on the internet. It is harmless today only because a same-site cookie is carrying the whole defense.
