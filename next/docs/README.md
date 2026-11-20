# next docs (placeholders)

Placeholder copy for the documentation site after cutover. The structure
follows the production docs in [docs/public](../../docs/public), with fewer
pages. Each page states what the section covers and nothing more. Replace the
copy by hand; keep the frontmatter so the pages drop into the existing
Starlight site. Hostnames assume cutover (`api.plyr.fm` serves the Next
appview).

| page | replaces |
| --- | --- |
| `index.md` | `index.mdx` |
| `listeners.md` | `listeners.md` |
| `artists.md` | `artists.md` |
| `moderation.md` | `moderation.md`, `sensitive-content.md` |
| `developers/index.md` | `developers/index.mdx` |
| `developers/quickstart.md` | `developers/quickstart.md` |
| `developers/auth.md` | `developers/auth.md` |
| `developers/xrpc.md` | `developers/api-reference/*` (24 pages) |
| `developers/sdk.md` | SDK sections of `developers/index.mdx` |
| `developers/mcp.md` | `developers/agents.md` |
| `lexicons.md` | `lexicons/overview.md` |
| `troubleshooting.md` | `troubleshooting.md` |
| `glossary.md` | `glossary.md` |
| `contributing.md` | `contributing.mdx` |
| `legal/*` | `legal/*` (unchanged until rewritten) |

Dropped: `developers/publishing.md` (publishing is writing records; see
`lexicons.md`) and `developers/subsonic.md` (Next has no Subsonic API).
