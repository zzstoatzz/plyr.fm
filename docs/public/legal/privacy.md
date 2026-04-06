---
title: "privacy policy"
description: "how plyr.fm handles your data"
---

> **note:** the source of truth is `frontend/src/routes/privacy/+page.svelte`. this markdown is a plain-text mirror for reference.

**last updated:** march 22, 2026

plyr.fm ("we", "us", or "our") is an audio streaming application built on the [AT Protocol](https://atproto.com). this privacy policy applies to the instance at https://plyr.fm (the "site").

plyr.fm is open source under the MIT license. other instances or derivatives hosted elsewhere are not covered by this policy.

this policy explains what data we collect, what's public by design on the AT Protocol, and your rights.

## 1. the AT Protocol

plyr.fm uses the AT Protocol for identity and social features. this has important implications:

**public by design:** your DID, handle, profile, tracks, likes, comments, and playlists are stored on your PDS (Personal Data Server) and remain under your control. the AT Protocol is a public data protocol—this data is accessible to any AT Protocol application, not just plyr.fm.

**your PDS:** plyr.fm does not operate a PDS—we write records to wherever your account is hosted (e.g., bsky.social or a self-hosted PDS). we do not control that data; their privacy policies govern it.

**private data:** session tokens, preferences, and server logs are stored only on our servers.

## 2. data we collect

**you provide:** your AT Protocol identity when you sign in, audio files and metadata you upload, and preferences like accent color.

**automatically:** play counts, IP addresses, browser info, and session cookies for authentication.

## 3. how we use it

we use your data to provide the service, maintain your session, and improve the platform. we do not sell your data or use it for advertising.

## 4. third parties

we use:

- [Cloudflare](https://cloudflare.com) - CDN, storage (R2)
- [Fly.io](https://fly.io) - backend hosting
- [Neon](https://neon.tech) - database
- [Logfire](https://logfire.pydantic.dev) - error monitoring
- [AudD](https://audd.io) - audio fingerprinting for copyright detection
- [Anthropic](https://anthropic.com) - image analysis for content moderation
- [ATProtoFans](https://atprotofans.com) - supporter validation for gated content
- [Modal](https://modal.com) - audio processing for search embeddings
- [turbopuffer](https://turbopuffer.com) - vector storage for semantic search
- [Replicate](https://replicate.com) - ML inference for genre classification

we may also write records to your PDS using third-party lexicon namespaces (e.g., [teal.fm](https://teal.fm) for scrobbling) when you enable those features.

## 5. your rights

you can access, correct, or delete your data through settings. when you delete your account, we remove your files from our storage and your data from our database.

**we cannot delete:** your DID (you control it), data on other AT Protocol servers, or records in other users' PDSes.

## 6. security

we use HTTPS, encrypt sensitive data, and use HttpOnly cookies. no system is perfectly secure—report vulnerabilities to plyrdotfm@proton.me.

## 7. children

plyr.fm is not for children under 13. we do not knowingly collect data from children.

## 8. changes

we may update this policy. material changes will be posted with notice.

## contact

questions? plyrdotfm@proton.me
