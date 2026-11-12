# checks

Every kind of check on the next client, what it needs, and the command. Check
exit codes, not output.

| kind | where | runs in | command |
| --- | --- | --- | --- |
| lint | `scripts/check-code.mjs` | CI (`deploy-web-next.yml`) | `npm run lint` |
| types | `tsconfig.json` | CI | `npm run check` |
| model tests | `tests/*.test.ts` | CI, node's test runner | `npm test` |
| web export | `dist/` | CI | `npm run build:web` |
| native bundles | iOS and Android exports | CI on PRs | `npx expo export --platform ios --platform android` |
| browser checks | `scripts/check-*.cjs` | locally, not in CI | `node scripts/check-<name>.cjs` |

## browser checks

Each is a Playwright script over the web export, with fixture routes standing
in for the API, audio and artwork. Build first with `npm run build:web`.
Playwright comes from `frontend/` (run `bun install` there) unless
`PLAYWRIGHT_MODULE` points at another copy.

```sh
npm run checks                              # every check and what it needs
npm run checks:affected                     # the checks this branch reaches
npm run checks:affected -- --base HEAD~1    # against another base
npm run checks:affected -- --run            # and run them
```

Some checks need more than the export: a local PDS on `:5197` for disposable
OAuth accounts (`pds-browser-fixture.cjs`), or the compose Redis and Postgres
for local coordinators (`queue-fixture.cjs`). `npm run checks` says which.

What each check covers is kept by hand in
[scripts/checks.mjs](../scripts/checks.mjs). A changed file no check covers is
printed, so you can pick one or add the mapping. A change to a shared control
(`controls.tsx`, `Text`, `appearance`, `Sheet`, `app/_layout.tsx`, …) reaches
the UI audit, which runs axe and screenshots at 390 and 1280 wide in light and
dark. A change to the player reaches the whole player set.

A new check must fail without the change it guards and assert what the user
sees. Add it to `scripts/checks.mjs`; lint fails until you do.
