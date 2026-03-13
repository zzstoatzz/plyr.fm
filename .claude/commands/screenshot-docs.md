# screenshot capture for docs

capture screenshots of plyr.fm UI and embed them in documentation.

## argument

$ARGUMENTS — what to screenshot (e.g. "feed page", "login flow", "player controls", "search overlay", "portal dashboard")

## URLs

- **production**: `https://plyr.fm`
- **staging**: `https://stg.plyr.fm`

default to production unless told otherwise.

### page routes

| target | URL path |
|--------|----------|
| login page | `/` (click "log in") |
| feed | `/` (after auth) |
| search | `/` then `Cmd+K` |
| portal | `/portal` (needs auth) |
| track page | `/track/{id}` |
| profile | `/{handle}` |
| settings | `/settings` |

## workflow

use the chrome-devtools MCP tools:

1. **set viewport**: `resize_page(1280, 800)` for consistent dimensions
2. **navigate**: `new_page(url)` or `navigate_page(url)`
3. **wait**: `wait_for([text])` until content loads
4. **snapshot**: `take_snapshot()` to get accessibility tree with element UIDs
5. **interact** (if needed): `click(uid)` / `fill(uid, value)` to reach the target state
6. **capture**: `take_screenshot(filePath, uid, fullPage, format, quality)` — use `format: "png"`
7. **save to**: `docs-site/public/screenshots/{name}.png`

### auth handling

some views require login. when auth is needed:
1. navigate to the page
2. take a snapshot to find the login button
3. **ask the user** to help complete the login flow (passwords, 2FA, etc.)
4. once authenticated, proceed with screenshots

never attempt to automate credential entry — always pause and ask.

## naming convention

`{page}-{element}.png`

examples:
- `login-button.png` — the log in button on the landing page
- `feed-track-card.png` — a track card in the feed
- `player-controls.png` — the bottom player bar
- `search-overlay.png` — the Cmd+K search modal
- `portal-dashboard.png` — the artist portal main view
- `portal-upload-form.png` — the upload form

## embedding in docs

reference screenshots in markdown as:

```markdown
![description](/screenshots/filename.png)
```

the `docs-site/public/` directory is served at the root, so `/screenshots/` resolves correctly.

## example session

```
user: /screenshot-docs login page

agent:
1. resize_page(1280, 800)
2. new_page("https://plyr.fm")
3. wait_for(["log in"])
4. take_snapshot() → find the login button UID
5. take_screenshot({ filePath: "docs-site/public/screenshots/login-page.png" })
6. report: saved login-page.png
```

## tips

- use `take_snapshot()` before any interaction to get current element UIDs
- for element-level screenshots, pass the `uid` parameter to `take_screenshot`
- for full-page captures, use `fullPage: true`
- if the page has animations or loading states, use `wait_for` with expected text content
- take multiple screenshots if a flow has several steps (e.g. `login-step1.png`, `login-step2.png`)
