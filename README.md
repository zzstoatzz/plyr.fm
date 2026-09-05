<p align="center">
  <a href="https://plyr.fm"><img src="frontend/src/lib/assets/logo.svg" alt="plyr.fm record logo" width="128" height="128"></a>
</p>

<h1 align="center">plyr.fm</h1>
<p align="center"><strong>audio streaming on ATProto</strong><br>put something on. make something of your own.</p>
<p align="center">
  <a href="https://plyr.fm">listen</a> ·
  <a href="https://docs.plyr.fm/artists/">publish audio</a> ·
  <a href="https://docs.plyr.fm">docs</a> ·
  <a href="CONTRIBUTING.md">contribute</a>
</p>

plyr.fm is an open-source home for music and other audio, built on the protocol behind Bluesky. sign in with your ATProto identity, upload a track, or settle into someone else's corner of the catalog. tracks, likes, comments, and public playlists are published as records in your personal data server (PDS). private playlists stay private in plyr.fm’s database.

## find your next listen

- **make a queue** — browse artists, albums, tags, and playlists; search with Cmd/Ctrl+K; like a track or add it to a playlist from the player.
- **stay a while** — shuffle, repeat, skip through longer tracks, or let “keep playing” pick from your For You feed when the queue ends.
- **listen together** — tune into radio or join a jam for synchronized listening. leave a timed comment at the part you came back for.
- **take it with you** — download public tracks and whole albums where the artist allows it, with lossless originals preferred. connect teal.fm for scrobbling.

## put something into the world

upload audio with artwork, tags, and featured artists; arrange it into albums; share a track, playlist, album, or radio embed. AIFF and FLAC uploads get compatible playback renditions, and automatic genre suggestions help with tagging. artists can add support links and offer supporter-gated tracks.

your ATProto identity and public audio records are usable beyond plyr.fm. audio is served through a CDN, with PDS audio mirroring and bulk export available; [the artist guide](https://docs.plyr.fm/artists/) explains publishing, downloads, and leaving the platform. [moderation](https://docs.plyr.fm/moderation/) uses signed ATProto labels, listener preferences, and a review queue.

this is a small, actively evolving project. [STATUS.md](STATUS.md) records current work and known rough edges. you can also **[hear the development notes](https://plyr.fm/u/plyr.fm)** — the project's own artist page carries its [automatically generated development podcast](.github/workflows/status-maintenance.yml).

## under the hood

| piece | what it does | built with |
| --- | --- | --- |
| [frontend](frontend/) | persistent player and queue, discovery, publishing tools, shared listening, and embeds | SvelteKit, Svelte 5 runes, Bun, vanilla CSS; Cloudflare Pages |
| [backend](backend/) | ATProto OAuth, audio delivery, records, catalog, and background jobs | FastAPI, Neon Postgres, R2, [docket](https://github.com/zzstoatzz/docket), Redis; Fly.io |
| [services](services/) | audio conversion, signed moderation labels, and audio analysis | Rust + ffmpeg transcoder, Rust labeler, CLAP on Modal, genre classification on Replicate |

[Pydantic Logfire](https://logfire.pydantic.dev) provides observability. CLAP embeddings and [turbopuffer](https://turbopuffer.com) power the feature-flagged mood search and audio recommendations. developers can use the [public API](https://api.plyr.fm/docs), [ATProto lexicons](https://docs.plyr.fm/lexicons/overview/), or the [Python SDK / MCP server](https://github.com/zzstoatzz/plyr-python-client).

## work on plyr.fm

start with the [contributing guide](CONTRIBUTING.md) and [local setup](https://docs.plyr.fm/contributing/). once configured, run these from the repository root in separate terminals:

```sh
just backend run       # FastAPI, port 8001
just frontend run      # SvelteKit, port 5173
```

`just --list` shows the available workflows. coding assistants should read [STATUS.md](STATUS.md) and [AGENTS.md](AGENTS.md); shared skills live in [.agents/skills](.agents/skills), with Claude-compatible symlinks. [the skill catalog](docs/internal/tools/skills.md) explains discovery and usage.

merges to `main` deploy **[staging](https://stg.plyr.fm)**. production is a separate promote through the [release workflow](docs/internal/deployment/environments.md).

## keeping it running

[the live cost dashboard](https://plyr.fm/costs) and [COSTS.md](COSTS.md) track the infrastructure bill and its attribution gaps. some features may eventually be paid to keep the project sustainable; [join the discussion](https://github.com/zzstoatzz/plyr.fm/discussions).

development happens on [GitHub](https://github.com/zzstoatzz/plyr.fm), with a [Tangled mirror](https://tangled.org/zzstoatzz.io/plyr.fm). public guides live at [docs.plyr.fm](https://docs.plyr.fm); architecture and runbooks live in [docs/internal](docs/internal/).
