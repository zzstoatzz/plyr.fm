# postmortem: cloudflare pages post-migration build failures 2026-04-22

## summary

after migrating from the `Nate@prefect.io` Cloudflare account to `N8@zzstoatzz.io` on 2026-04-18, the `plyr-fm` and `plyr-fm-stg` Cloudflare Pages projects were recreated as "Direct Uploads" type with no git integration. on 2026-04-22 we restored the git integration by deleting the (still-active) prefect.io Pages projects and recreating fresh projects on the zzstoatzz account with `source.type = "github"` set via POST. every git-driven build that followed failed silently — the POST accepted `deployment_configs.production.env_vars` in the body but did not persist them, and `build_config.destination_dir` reverted to an incorrect value. the CF webhook was firing correctly, but every build errored on `import { PUBLIC_API_URL } from '$env/static/public'` because the variable wasn't present at build time. manual `wrangler pages deploy` calls from a developer machine (with `PUBLIC_API_URL` set in the shell) masked the real problem for ~3 hours by keeping the live site on a known-good ad-hoc deploy — at the cost of one ~45-minute window where `/track/[id]` and `/u/[handle]` 404'd on prod because an earlier local build baked `http://localhost:8001` into `API_URL`.

## timeline (UTC)

| time | event |
|------|-------|
| 2026-04-18T07:40 | CF account migration: new `plyr-fm` + `plyr-fm-stg` Pages projects created on zzstoatzz account as **Direct Uploads** (no git source). prefect.io projects remain git-integrated against the repo. |
| 2026-04-18 → 2026-04-22 | prefect.io projects receive **stealth builds** on every push to `main` / `production-fe` — their custom domains are deactivated so nobody sees the output, but CF keeps rebuilding them. ~2,945 deploys on `plyr-fm-stg` + ~3,547 on `plyr-fm` accumulate over 4 days. |
| 2026-04-19T05:42 | someone runs `wrangler pages deploy` once against the zzstoatzz `plyr-fm` project with commit `a4977bc2` (#1310). this becomes the "live" production bundle. no further deploys for 3 days. |
| 2026-04-19 → 2026-04-22 | `just release` pushes to `production-fe` do nothing: new-account projects have no git integration, prefect.io builds are invisible. nobody notices because the frozen #1310 bundle keeps serving. |
| 2026-04-22T13:30 | audio-replace feature (#1311-#1313) is reported "not on prod" — investigation reveals the frozen-bundle situation. |
| 2026-04-22T14:20 | decision: delete the prefect.io projects (requires grinding through ~6,500 deployment deletions), create fresh zzstoatzz projects with git source via API POST. |
| 2026-04-22T15:25 | new `plyr-fm-stg` created with `source.type: "github"` via `POST /pages/projects`. POST body includes `deployment_configs.production.env_vars: { PUBLIC_API_URL, SKIP_DEPENDENCY_INSTALL }` and `build_config.destination_dir: "frontend/.svelte-kit/cloudflare"`. POST returns 200. **no follow-up GET to verify env_vars persisted.** |
| 2026-04-22T15:25 | initial build manually triggered via `POST /deployments?branch=main` — succeeds. looks like the migration worked. |
| 2026-04-22T15:34 | same pattern for `plyr-fm`. |
| 2026-04-22T15:52 | `just release` (version `2026.0422.155233`) — `production-fe` push does not trigger an auto-build. assumed to be a CF webhook quirk. manually POST'd `/deployments` to work around it. build succeeds (direct upload path; still no SvelteKit build step). |
| 2026-04-22T18:12 | second release (`2026.0422.181250`) — same behavior, same manual workaround. |
| 2026-04-22T18:16 | PR #1326 merged (frontend-only button font fix). `just release-frontend-only` pushes `main → production-fe`. webhook still doesn't fire. fallback: `bun run build` locally **without `PUBLIC_API_URL` set**, then `wrangler pages deploy`. baked-in `API_URL = 'http://localhost:8001'`. |
| **2026-04-22T18:23** | **outage window begins**: `/track/[id]`, `/u/[handle]` return 404 on prod. SSR load functions call `fetch('http://localhost:8001/...')` from the worker runtime, fail, throw `error(404)`. home page + static routes still serve fine. |
| 2026-04-22T19:05 | user reports "everything is 4o4ing". diagnosis takes ~15 min — frontend routes that do `+page.server.ts` data loading are all failing, param-less routes are fine. |
| 2026-04-22T19:53 | redeploy via local `wrangler pages deploy` with `PUBLIC_API_URL=https://api.plyr.fm bun run build` — **outage ends**. ~45 min after onset. |
| 2026-04-22T19:57 | user asks a sharper question: why doesn't CF git auto-build? user separately discovers the GitHub App integration had `plyr.fm` deselected (manual mistake during earlier debugging) — re-selects the repo. |
| 2026-04-22T19:58 | #1327 merged, `just release-frontend-only`. GitHub webhook delivery now flows to CF. |
| 2026-04-22T20:13 | verify via `wrangler pages deployment list`: **both `plyr-fm` and `plyr-fm-stg` show failed builds** for commit `8f20e8e` — the CF webhook has been firing all along since the GH reconnect. build logs (via CF API `/deployments/{id}/history/logs`) show `import { PUBLIC_API_URL } from '$env/static/public'` → rollup can't resolve. |
| 2026-04-22T20:15 | GET project config via API: **`env_vars: null` on both production and preview deployment_configs.** the POST from 15:25 silently dropped them. `destination_dir` is `.svelte-kit/cloudflare` (missing `frontend/` prefix) — also reverted. |
| 2026-04-22T20:17 | PATCH both projects to restore `env_vars` and corrected `destination_dir`. GET verifies the values persist this time. |
| 2026-04-22T20:18 | `POST /deployments/{id}/retry` on both failed builds — both queue successfully. |

**user-visible outage: ~45 minutes** (prod SSR routes, partial). root-cause silent build failures: **4 days** (from 2026-04-18 recreation window through 2026-04-22 fix).

## root causes

### 1. CF Pages API silently dropped `env_vars` on project creation

`POST /accounts/{id}/pages/projects` accepted `deployment_configs.production.env_vars` in the body and returned a 200 response, but the created project came back with `env_vars: null`. no error, no warning. the OpenAPI schema documents the field as part of the create-project request body; either CF has a bug in its create path that ignores the nested env_vars, or a subsequent operation (e.g. my own `wrangler pages deploy --branch=production-fe`) wiped them. either way, **any CF-driven build with the project in this state breaks on `$env/static/public` imports**. 

### 2. follow-up GET-to-verify was skipped

after the POST, the returned body wasn't inspected for env_vars, and no subsequent GET confirmed the values were retrievable. the check that would have caught this took 2 lines and ran successfully after the fix.

### 3. manual `wrangler pages deploy` masked the build failure

using `wrangler pages deploy <built-directory> --branch=production-fe` uploads an already-built bundle as a new deployment. it skips the CF build pipeline entirely, so missing `env_vars` never surface. the live site served from these ad-hoc deploys while the parallel git-triggered builds were failing silently — and no one noticed, because the manual deploys kept the site green.

### 4. local `bun run build` can bake the wrong API URL into the bundle

SvelteKit's `$env/static/public` inlines `PUBLIC_API_URL` into the compiled bundle at build time. when `bun run build` runs locally without `PUBLIC_API_URL` set, the `|| 'http://localhost:8001'` fallback in `frontend/src/lib/config.ts:3` gets baked in. any `wrangler pages deploy` of that bundle renders prod SSR useless.

### 5. CF account migration didn't carry over git integration

the original 2026-04-18 migration created **Direct Uploads** projects on the new account instead of git-integrated ones. CF doesn't support converting a Direct Uploads project to a git-integrated one (API error `8000069`: *"You cannot update the `source` object in a Direct Uploads project"*). this required deleting + recreating the projects on 2026-04-22 — but also required deleting the leftover prefect.io projects (still holding the repo lock on the old account, error `8000093`), which individually required deleting ~6,500 aggregated deployments by hand via API pagination. none of this was in any runbook.

### 6. CF Pages GitHub App installation had the repo deselected

separate but adjacent: at some point during debugging on 2026-04-22, `zzstoatzz/plyr.fm` got removed from the GitHub App's repository access list. this silently stopped CF from receiving any webhook events. the user fixed this by re-adding the repo. this is why the first two `just release` calls today (`15:52`, `18:12`) had no matching CF-side build record — the webhook literally never reached CF.

## impact

- **duration of user-visible outage**: ~45 minutes (2026-04-22T18:23 → 19:53)
- **scope of user-visible outage**: `/track/[id]`, `/u/[handle]`, and any other SSR route whose `+page.server.ts` fetches from `${API_URL}/...`. auth'd pages, static pages, client-side-loaded pages all fine.
- **data loss**: none
- **duration of silent misconfiguration**: 4 days (2026-04-18 → 2026-04-22). no builds were actually happening on the new account's Pages; the site served a frozen commit (`a4977bc2` / #1310) that predated audio-replace (#1311-#1313) and all subsequent frontend work.
- **engineering time burned**: most of a day across debugging, project recreation, deployment-deletion grinding, and recovery.

## action items

### immediate (done or in-flight)

1. **PATCH both projects to restore env_vars + destination_dir** — done 2026-04-22T20:17.
2. **retry the two failed CF-driven builds** — done. verify via live bundle version flip.
3. **write this retro** — meta, done.

### post-incident

4. **add a `docs/internal/runbooks/cloudflare-migration.md` runbook** covering:
   - the Direct-Uploads-can't-be-converted trap (error 8000069)
   - the cross-account repo lock (error 8000093) and that deleting projects with accumulated deployments requires iterating `DELETE /deployments/{id}?force=true` per deployment
   - the mandatory verify-after-write step: after any create/patch on a Pages project, `GET /projects/{name}` and diff against the intended config
   - the GitHub App installation step on the receiving CF account (explicit re-selection of repo after account move)
   - the build-config keys that tend to revert: `destination_dir`, `env_vars`, `preview_deployment_setting`
5. **never deploy from local** — append to `.claude/CLAUDE.md` / `docs/internal/deployment/environments.md`: local `wrangler pages deploy` is banned because (a) it can bake wrong env vars into the bundle, (b) it masks CF-driven build failures by keeping the site green. deployments happen in CI only, whether via CF git integration or GHA workflow.
6. **consider: a `just verify-pages-config` script** that hits the CF API and diffs `env_vars` / `build_config` against a checked-in spec. would have caught this in 2 seconds on 2026-04-18.
7. **consider: GHA workflow as defense-in-depth** — originally proposed in #1323 (closed). if CF's git integration breaks again (it's already broken twice: dashboard-vs-API create path, GH App install scope), a `workflow_dispatch`-able GHA workflow that runs `wrangler pages deploy` with `PUBLIC_API_URL` set from CI secrets gives us a manual recovery lever that isn't a developer's laptop.

### investigate (low priority)

8. **why did the CF POST silently drop env_vars?** — either a bug in `POST /pages/projects`'s create path, or a subsequent `wrangler pages deploy --branch=...` call wiped the `deployment_configs` section as a side effect. either is fixable on CF's side; worth filing with support if we reproduce.

## related incidents

- [2025-11-12 banana mix incident](./2025-11-12-banana-mix-incident.md) — also caused by silent state: R2 delete didn't check refcount. theme: **we trust that successful API calls preserve the state we asked for**, which isn't always true.
- [2025-11-17 connection pool outage](./2025-11-17-connection-pool-outage.md) — also surfaced only after a change unrelated to the root cause (a migration) amplified a pre-existing hole.

## key lesson

**successful ≠ persisted**. every create/patch against an external API needs an immediately-subsequent GET that inspects the fields we care about. today's ~45-minute outage (and the 4-day silent-deploy problem preceding it) is entirely contained by a GET-after-POST that would have taken 2 seconds to write.

the secondary lesson — **local deploys are a load-bearing anti-pattern** — was already in our memory conventions. I violated it repeatedly today to "unstick" things, and the `localhost:8001`-baked-into-prod outcome is a textbook demonstration of why the rule exists.

## references

- `scripts/release` — pushes `main → production-fe`, relies on CF git integration to pick up
- `frontend/src/lib/config.ts:3` — `API_URL` fallback to `localhost:8001` (this is the chekhov's gun that fired)
- `docs/internal/deployment/environments.md` — describes the intended CF Pages build config (fixed today in #1324)
- CF API: `POST /accounts/{id}/pages/projects`, `PATCH /accounts/{id}/pages/projects/{name}`, `POST /deployments/{id}/retry`
- PRs affected / involved: #1311, #1312, #1313 (audio-replace), #1318-#1320 (audio revisions), #1323 (closed GHA workflow PR), #1324 (docs fix), #1325 (blob re-upload fix), #1326 (button font fix), #1327 (button font follow-up)
- releases: `2026.0422.155233`, `2026.0422.181250`
