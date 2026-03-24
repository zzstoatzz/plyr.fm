---
description: capture screenshots of plyr.fm UI and embed them in documentation
argument-hint: "[target]"
---

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
| login page | `/` (click "sign in") |
| feed | `/` (after auth) |
| search | `/` then `Cmd+K` |
| portal | `/portal` (needs auth) |
| track page | `/track/{id}` |
| profile | `/{handle}` |
| settings | `/settings` |

## workflow

use the chrome-devtools MCP tools:

1. **set viewport**: `resize_page(width, height)` — size depends on the subject (see framing guide below)
2. **navigate**: `new_page(url)` or `navigate_page(url)`
3. **wait**: `wait_for([text])` until content loads
4. **snapshot**: `take_snapshot()` to get accessibility tree with element UIDs
5. **interact** (if needed): `click(uid)` / `fill(uid, value)` to reach the target state
6. **capture**: `take_screenshot(filePath, uid, fullPage, format, quality)` — use `format: "png"`
7. **save to**: `docs-site/public/screenshots/{name}.png`
8. **review**: `open -a Preview <path>` and ask the user if framing looks right before committing

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
- `login-button.png` — the sign in button on the landing page
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
1. resize_page(500, 580)  ← viewport sized to fit the login modal
2. new_page("https://plyr.fm")
3. wait_for(["sign in"])
4. click(login_button_uid)
5. wait_for(["handle"])
6. take_screenshot({ filePath: "docs-site/public/screenshots/login-page.png" })
7. Read the image file to self-review framing
8. open -a Preview <path> and ask user to confirm
```

## framing guide

the goal is to bring the subject into full focus while showing the entire element — no clipping, no sea of empty space.

### strategy: resize the viewport to fit the subject

do NOT use a fixed viewport for everything. instead, resize the viewport so the subject fills the frame naturally:

| subject type | approach | example viewport |
|---|---|---|
| modal/dialog (login, search) | shrink viewport so modal fills frame | `500x580` for login form |
| feed/browse view | mid-width to show content density | `900x700` for top tracks + latest |
| single element (track card) | hide overlays, scroll into view, viewport capture + crop | `500x200` then crop to element |
| full page context (nav + content) | standard width | `1280x800` |

### rules

1. **the subject must fill the frame** — if there's more background than subject, the viewport is too large
2. **never clip the subject** — the entire element must be visible. if a track card has tags, the tags must be fully visible
3. **hide sticky overlays** — use `evaluate_script` to `display:none` the sticky header, floating queue button, or any other overlay before capturing. these block the subject
4. **viewport + crop for isolated elements** — `take_screenshot(uid=...)` often gets wrong bounds. instead: hide overlays, scroll element to top with `scrollIntoView`, take viewport screenshot, then crop with `uv run --with Pillow` (see cropping below)
5. **viewport captures for context** — use viewport screenshots when showing how elements relate to each other (nav + feed, search over content)
6. **never use `fullPage: true`** unless explicitly asked — it captures the entire scrollable page which can be thousands of pixels tall
7. **always self-review** — use the `Read` tool to view the image yourself before showing the user. check: is the subject visible? is anything clipped? is there too much empty space?
8. **then open in Preview** — run `open -a Preview <path>` and ask the user to confirm. framing is subjective and worth the round-trip
9. **retina is fine** — macOS captures at 2x device pixels. a 500px viewport produces a 1000px image. this is good for sharpness, don't fight it

### what "too zoomed in" looks like

- element is clipped (tags cut off, buttons missing)
- no padding around the subject

### what "too zoomed out" looks like

- subject is a small island in a dark void
- lots of empty background around a centered modal
- the 1280x800 viewport showing a 400px-wide login form

### cropping

when a viewport screenshot has excess space (e.g. browser minimum height > element height), crop with ephemeral Pillow:

```bash
uv run --with Pillow python3 -c "
from PIL import Image
img = Image.open('docs-site/public/screenshots/name.png')
cropped = img.crop((0, 0, img.width, TARGET_HEIGHT))  # top-anchored crop
cropped.save('docs-site/public/screenshots/name.png')
"
```

remember: retina means CSS pixels × 2. a 138px CSS element = ~276px in the image. add ~20px padding.

never use `pip` or touch the project venv — `uv run --with` installs ephemerally.

### hiding overlays

plyr.fm has a sticky header and a floating queue button. hide them before capturing individual elements:

```js
// in evaluate_script
document.querySelector('header').style.display = 'none';
// find and hide queue button too
```

after hiding, re-scroll the target element into view since layout shifts.

## tips

- use `take_snapshot()` before any interaction to get current element UIDs
- use `evaluate_script` to find elements by class (`.track-container`, `.track-info`) and get bounding rects
- if the page has animations or loading states, use `wait_for` with expected text content
- take multiple screenshots if a flow has several steps (e.g. `login-step1.png`, `login-step2.png`)
- **always Read the screenshot file** to visually check it before showing the user — you can see images
- `take_screenshot(uid=...)` often captures wrong bounds for styled containers — prefer viewport + crop
