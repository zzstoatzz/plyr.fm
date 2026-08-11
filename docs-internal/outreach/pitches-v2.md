# outreach pitches (v2)

changes from v1: added a light touch on timing — the protocol is actively being designed to support access control and gated content, and music is one of the strongest use cases driving that work. this isn't a hard sell on future features; it's a single sentence that signals "this is early and evolving, and that's the point." the label pitch leans into this slightly more since labels think in terms of distribution control. also added inline links throughout: atproto.com guides for key claims (identity, data repos, account migration, feeds), actual bsky.app feed links for the music atmosphere feeds, and proper URLs in breadcrumbs.

## artist pitch

> hey [name] — i'm nate, i build open-source software and i live in chicago.
>
> i've been building [plyr.fm](https://plyr.fm), an audio streaming platform on the [AT Protocol](https://atproto.com) (the technology behind bluesky). there's a growing ecosystem of apps being built on atproto — social media, music, video, publishing — and they all share something important: your [identity](https://atproto.com/guides/identity), your content, and your audience belong to you, not to the platform.
>
> what that looks like in practice: your bluesky handle is your artist identity on plyr.fm. same followers, same social graph, no "link in bio" fragmentation. if plyr.fm goes away tomorrow, your music and your listeners don't disappear with it — the data lives on the open web, and [any app can pick it up](https://atproto.com/guides/account-migration). it's your catalogue, [stored under your identity](https://atproto.com/guides/data-repos), portable by design.
>
> here's a small example of what this ecosystem makes possible: i built a feed called ["music atmosphere"](https://bsky.app/profile/did:plc:vs3hnzq2daqbszxlysywzy54/feed/music-atmosphere) that surfaces every music link shared on bluesky in real time — spotify, bandcamp, soundcloud, plyr.fm, all of it. there's also a version filtered to just [music shared by people you follow](https://bsky.app/profile/did:plc:vs3hnzq2daqbszxlysywzy54/feed/music-following). i was able to build both of these because all the data on the network is open — anyone can create their own [algorithmic feed](https://atproto.com/guides/feeds) with whatever logic they want, using tools like [graze.social](https://graze.social). you don't have to wait for spotify or apple to decide what their algorithm shows people. anyone can build that layer.
>
> the protocol is also actively being designed to support things like gated content and access control — the kind of infrastructure that lets artists release music on their own terms. it's early, and that's part of what makes the timing interesting.
>
> [1-2 sentences of personalization — something specific about their music, why they caught your attention]
>
> i'd love to chat if any of this resonates — plyrdotfm@proton.me or find me on bluesky at @zzstoatzz.io. if you want to poke around: [plyr.fm](https://plyr.fm)

## label pitch

> hey — i'm nate, i build open-source software and i live in chicago.
>
> i've been building [plyr.fm](https://plyr.fm), an audio streaming platform on the [AT Protocol](https://atproto.com) (the technology behind bluesky). there's a growing ecosystem of apps on atproto right now — social media, music, video, publishing — and they share a core idea: content and audience relationships belong to the people who create them, not to the platforms that host them.
>
> for a label, that means your artists' catalogues and listener relationships aren't locked inside a platform you don't control. their bluesky [identity](https://atproto.com/guides/identity) is their music identity — same handle, same followers across every app in the ecosystem. distribution isn't something a platform holds over your head; it's built into the protocol. and if plyr.fm or any other app goes away, the music and the audience don't go with it. the data is on the open web, [portable by design](https://atproto.com/guides/account-migration).
>
> here's a concrete example: i built a feed called ["music atmosphere"](https://bsky.app/profile/did:plc:vs3hnzq2daqbszxlysywzy54/feed/music-atmosphere) that picks up every music link shared across bluesky — spotify, bandcamp, soundcloud, plyr.fm, everything — in real time. there's a version that shows all music, and one filtered to just [music from people you follow](https://bsky.app/profile/did:plc:vs3hnzq2daqbszxlysywzy54/feed/music-following). i was able to build this because all the data on the network is open. anyone can create custom [feeds](https://atproto.com/guides/feeds) and discovery algorithms with whatever logic they want, using tools like [graze.social](https://graze.social). discovery and curation aren't controlled by one company's algorithm — they're open for anyone to build on.
>
> the protocol is also actively evolving — the team behind it is designing support for permissioned content and access control right now, with music being one of the driving use cases. things like gated releases, controlled distribution windows, supporter-only content — that infrastructure is being built into the protocol layer, not bolted on by a single platform. being involved early means having a voice in how it takes shape.
>
> bluesky already has 40M+ users, and the ecosystem is growing. there's real momentum here, and music is a natural fit.
>
> [1-2 sentences of personalization — something about their roster, their ethos, why they caught your attention]
>
> i'd love to have a conversation about whether this is interesting to you — plyrdotfm@proton.me or DM me on bluesky at @zzstoatzz.io. if you want to look around first: [plyr.fm](https://plyr.fm), and [docs.plyr.fm](https://docs.plyr.fm) for the technical side.

## key messaging principles

drawn from the atproto team's language (atproto.com, the ethos article, dan abramov's articles):

- **lead with the ecosystem, not the problem.** "there's a growing ecosystem" rather than "platforms are broken." positive framing.
- **"portable by design"** — the data lives on the open web. if an app goes away, the data doesn't.
- **identity is the anchor.** your bluesky handle is your handle everywhere. no fragmentation.
- **"link in bio" is the most visceral pain point.** everyone understands the frustration of begging followers to hop between silos.
- **credible exit.** you can always leave and take everything with you. this keeps platforms honest.
- **don't say "decentralized."** say "open web" or "portable." don't say "federation." say "ecosystem."
- **no crypto disclaimers.** atproto is not crypto. don't even bring it up unless they do.
- **no hedging about industry ignorance.** be confident about what you've built. ask questions, don't apologize.
- **CTA ladder:** start a conversation → check it out → upload music. don't lead with the big ask.
- **the feed is a show-don't-tell moment.** it demonstrates that the open data model isn't theoretical — someone already built a custom music discovery algorithm over it. and anyone else can too.
- **timing, not hype.** the protocol is being actively designed. mention this as context ("it's early, and that's part of what makes it interesting"), not as a sales pitch. don't oversell features that don't exist yet.

## breadcrumbs for curious recipients

if they want to go deeper, point them to:

- **[plyr.fm](https://plyr.fm)** — the app itself
- **[docs.plyr.fm](https://docs.plyr.fm)** — how it works, how to upload, lexicon schemas
- **music atmosphere feed** — live feed of music being shared on bluesky. three variants: [all music](https://bsky.app/profile/did:plc:vs3hnzq2daqbszxlysywzy54/feed/music-atmosphere), [music from your follows](https://bsky.app/profile/did:plc:vs3hnzq2daqbszxlysywzy54/feed/music-following), and an ["organic" version](https://bsky.app/profile/did:plc:vs3hnzq2daqbszxlysywzy54/feed/music-organic) that filters out bots. dashboard at [music-atmosphere-feed.plyr.fm](https://music-atmosphere-feed.plyr.fm)
- **[graze.social](https://graze.social)** — build your own custom feed with natural language or custom logic
- **[atproto.com](https://atproto.com)** — the protocol ("building the social internet"). key pages: [identity](https://atproto.com/guides/identity), [data repos](https://atproto.com/guides/data-repos), [account migration](https://atproto.com/guides/account-migration), [feeds](https://atproto.com/guides/feeds)
- **[overreacted.io/open-social](https://overreacted.io/open-social/)** — dan abramov's explainer ("what open source did for code, open social does for data")
- **[permissioned data diary](https://dholms.leaflet.pub/3meluqcwky22a)** — daniel holmgren's design series on access control for atproto
