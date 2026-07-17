---
title: "agent access preflight"
---

operational work should begin by proving access to the systems in scope. Do not
wait until an incident is underway to discover that a connector is missing, a
desktop restart is required, or a credential authorizes a different operation.

this runbook records capabilities, not secret values. Never print environment
values, connection strings, app passwords, API tokens, or Fly secrets while
performing the checks below.

## five-minute preflight

| system | preferred access | read-only proof | write-path note |
|---|---|---|---|
| GitHub | GitHub connector, then `gh` fallback | inspect the repository or run `gh auth status` | the connector installation may be read-only for PR creation; `gh` is the supported fallback |
| Fly.io | `fly` CLI | `fly auth whoami` and `fly status -a <app>` | production deploys happen through GitHub workflows, never `fly deploy` locally |
| Neon | Neon Postgres connector | search for `plyr` projects | name the project and environment before every query; do not expose connection strings |
| Cloudflare | Cloudflare connector | list Pages projects | installing or enabling the plugin may require restarting Codex before tools appear |
| labeler | public HTTP plus Fly | `GET https://moderation.plyr.fm/health` and public `queryLabels` | protected endpoints require `MODERATION_AUTH_TOKEN` |
| ATProto labeler account | app-password session | resolve `moderation.plyr.fm` and inspect its service declaration | `MODERATION_BSKY_PASSWORD` changes the account's declaration; it does not authorize label emission |

if a required capability is absent, report the exact missing system and action
immediately. For example: “Neon project discovery is unavailable” is actionable;
“I need more access” is not. After a connector is installed, restart Codex and
repeat the proof before continuing.

## environment and resource map

### Neon

| project | ID | purpose |
|---|---|---|
| `plyr-prd` | `cold-butterfly-11920742` | production application data |
| `plyr-stg` | `frosty-math-37367092` | staging application data |
| `plyr-dev` | `muddy-flower-98795112` | development application data |
| `plyr-moderation` | `rough-hall-37695610` | labeler labels, context, reports, and sensitive-image state |

the moderation database is separate from the production application database.
Track metadata such as ID, AT URI, and CID comes from `plyr-prd`; signed label
state comes from `plyr-moderation` or the public XRPC endpoint.

### Fly.io

| app | purpose |
|---|---|
| `relay-api` | production backend and Redis-connected process groups |
| `relay-api-staging` | staging backend |
| `plyr-moderation` | production moderation and labeler service |

use `-g app` when an SSH command must run in the production API process group;
otherwise Fly may select the jetstream or worker machine.

### Cloudflare Pages

| project | production branch | domain |
|---|---|---|
| `plyr-fm` | `production-fe` | `plyr.fm` |
| `plyr-fm-stg` | `main` | `stg.plyr.fm` |
| `plyr-storybook` | `main` | Storybook |
| `plyr-fm-docs` | workflow deployment | `docs.plyr.fm` |

the Pages project is named `plyr-fm`. The `name = "plyr"` value in
`frontend/wrangler.toml` is not the Pages project name and should not be used to
look up deployments.

## moderation credential matrix

| credential | authorizes | does not authorize |
|---|---|---|
| `MODERATION_AUTH_TOKEN` | `/emit-label`, `/admin/labels`, reports, and other protected moderation-service endpoints | updating the ATProto labeler service record |
| `MODERATION_BSKY_PASSWORD` | an app-password session for the `moderation.plyr.fm` ATProto account, including its labeler declaration record | protected moderation-service HTTP endpoints |
| labeler signing key (Fly secret) | cryptographic signing inside `plyr-moderation` | operator login; it must never leave the service |

an app password and an API authorization token are not interchangeable. Check
for the required variable by name without printing its value. If
`MODERATION_AUTH_TOKEN` is unavailable for an operator action, stop and request
that capability instead of trying unrelated credentials.

## production deployment choices

- backend or migration changes: `just release`
- frontend-only changes: `just release-frontend-only`
- docs: merge to `main`; `.github/workflows/deploy-docs.yml` publishes them
- moderation service: merge to `main`; `.github/workflows/deploy-moderation.yml`
  deploys changes under `services/moderation/**`

`just release` intentionally rejects a frontend-only diff. That rejection is a
direction to use the frontend-only recipe, not a failed production deployment.

## known tooling gaps

the access preflight prevents discovery delays, but this workflow gap still
needs product work:

1. [generic label emission and cache invalidation](https://github.com/zzstoatzz/plyr.fm/issues/1678)
   have no first-class operator CLI or generic-label UI; the protected HTTP
   endpoint is the only write API
track these gaps in GitHub rather than embedding fragile secret-extraction or
container-shell workarounds in agent instructions. Moderation staging remains
tracked separately in [#1165](https://github.com/zzstoatzz/plyr.fm/issues/1165).
