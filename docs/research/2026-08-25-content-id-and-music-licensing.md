# research: how big platforms let users post copyrighted music (and pay for it)

**date**: 2026-08-25
**question**: YouTube demonetizes a concert phone-video; Instagram lets you overdub a copyrighted song on a story. how are the big platforms buying those rights and routing money back to rights holders — and what could a platform plyr's size realistically do?

## summary

the big platforms solve this with two coupled systems: a fingerprint-matching pipeline (Content ID / Rights Manager) and **privately negotiated blanket licenses** with labels and publishers that no statute provides and no small platform can get on comparable terms. for audio-only interactive streaming the composition side is actually coverable by statute (MLC mechanical blanket + PRO performance blankets); the wall is always the **sound recording**, which has no compulsory path for interactive use. we had not written any of this down before — prior in-repo material is bullets and open lawyer questions (see "prior art" below).

## findings

### how Content ID actually works (YouTube)

- rights holders supply reference files; every upload is fingerprint-scanned; a match generates a claim with a per-territory policy: **monetize** (ad revenue routes to claimant), **track** (analytics only), or **block**. ([support.google.com/youtube/answer/6013276](https://support.google.com/youtube/answer/6013276))
- access is not open — restricted to rights holders with exclusive rights to a substantial catalog; small artists reach it through distributors/aggregators.
- scale (YouTube's own transparency reporting): **$12B cumulative paid to rightsholders via Content ID through 2024** ($3B in 2024 alone, all media not just music); 2.2B claims in 2024, ~99% of all copyright actions on the platform, >99% auto-detected. **over 90% of rightsholders choose monetize over block** — the economic core of the model. ([musically.com](https://musically.com/2025/05/23/youtubes-content-id-payouts-to-rightsholders-have-passed-12bn/), [primary report PDF](https://services.google.com/fh/files/misc/hytw_copyright_transparency_report.pdf))
- the concert-video / overdub case works because YouTube's platform-wide label+publisher deals cover **mechanical and sync for UGC** — making it nearly the only place a user can legally post a full-song video without their own sync license. ([entertainmentlawyer.pro](https://entertainmentlawyer.pro/mechanical-vs-sync-youtubes-platform-licenses-and-cross-platform-comparison/))
- known failure modes: false positives on short clips/background audio, overclaiming via manual claiming, and a dispute process where the claimant reviews disputes against itself.

### Meta / Instagram

- **Rights Manager** is Meta's Content ID analog; it powers claims and feeds the licensed Audio Library used for story/reel overdubs.
- the deals are blanket **lump-sum buyouts** with majors + Merlin (indies) for a set term, not per-use payment — the industry's chief complaint. leverage is real on both sides: Kobalt pulled its catalog in 2022; Italy's SIAE rejected a lump-sum offer in 2023 and got pulled. ([synchtank](https://www.synchtank.com/blog/licensing-lawsuits-and-revenue-sharing-metas-evolving-relationship-with-the-music-industry/), [MBW on SIAE](https://www.musicbusinessworldwide.com/in-a-shock-move-meta-has-pulled-music-by-italian-songwriters-from-its-platforms-is-this-connected-to-mark-zuckerbergs-year-of-efficiency/))
- Music Revenue Sharing (2022, FB videos ≥60s): creator keeps 20% of in-stream ad revenue; the other 80% splits between rights holders and Meta (ratio unpublished).

### TikTok

- same blanket model. the 2024 UMG dispute is the best public data point on terms: license lapsed Jan 31 2024, the entire UMG catalog (recordings, then compositions) was muted for ~3 months, new deal in May 2024 with "improved remuneration" — terms undisclosed. ([variety](https://variety.com/2024/music/news/tiktok-universal-music-group-settle-royalty-dispute-licensing-agreement-1235987271/))

### the actual license taxonomy (US)

every song is two copyrights: **sound recording** (label/artist) and **composition** (publisher/songwriter).

| right | blanket/compulsory path? | who / cost |
|---|---|---|
| composition mechanical (interactive audio streams) | **yes** — MMA §115 blanket via **the MLC**, open to any qualifying DSP | notice of license + annual admin assessment; headline rate ~15.3% of service revenue (Phonorecords IV, approximate) ([themlc.com/dsp-faqs](https://www.themlc.com/dsp-faqs)) |
| composition public performance | **yes** — ASCAP/BMI/SESAC/GMR blankets, available to anyone (ASCAP/BMI must license under consent decrees) | scales with revenue; small-business fees roughly hundreds to low thousands/yr per PRO (approximate); need all four |
| sound recording, **non-interactive** performance | **yes** — §114 statutory via SoundExchange, with programming rules (max 4 tracks/artist per 3h, ≤3 consecutive, no advance playlists) ([soundexchange licensing 101](https://www.soundexchange.com/service-provider/licensing-101/)) | statutory rates |
| sound recording, **interactive** use | **no** — direct label deals only | this is the wall |
| sync (music + video, incl. overdubs) | **no** — individually negotiated with publisher *and* label; no blanket regime exists ([NYU L. Rev.](https://nyulawreview.org/wp-content/uploads/2024/07/99-NYU-L-Rev-1045.pdf)) | the hard wall for UGC video |

EU contrast: DSM Article 17 makes platforms directly liable for uploads (license-or-filter), but member-state extended collective licensing gives EU platforms a blanket path the US lacks; startups <3yrs old and <€10M turnover get lighter obligations.

### what platforms our size have actually done

- **Mixcloud** — the canonical licensed-UGC-mix platform. direct deals with all three majors + Merlin + publishers + PROs; its own content-ID identifies tracks *inside mixes* and routes per-play royalties; DJs clear nothing. rights costs eat ~65–70% of gross (creator subscriptions net ~60% to creators). took years and product concessions (radio-like listening restrictions in some regions). ([mixcloud help](https://help.mixcloud.com/hc/en-us/articles/360004185159), [founder interview](https://djtechtools.com/2020/11/18/mixcloud-founder-heres-what-djs-need-to-know-about-music-copyright/))
- **SoundCloud** — years unlicensed, then major-label + Merlin deals 2014–2016 (takedowns dropped ~40% after); 2017 extended monetization to DJ mixes/remixes; fan-powered royalties since 2021. the deals took subscription/ad products and equity-scale negotiation.
- **Pex / Attribution Engine** — fingerprinting (incl. remixes, sped-up versions) + a registry offering **micro-licenses** from participating rightsholders at upload time, explicitly pitched at platforms that can't get blanket deals; acquired Dubset (legalized mix clearance) in 2020. coverage limited by rightsholder participation. ([pex.com](https://pex.com/products/attribution-engine/))
- **Audible Magic** — incumbent identification vendor plus a "UGC Music Rights Platform" bundling licensing + rights administration for UGC platforms. ([audiblemagic.com](https://www.audiblemagic.com/))
- **Lickd** — pre-cleared major-label tracks per-video for creators (from ~$8); solves the creator side, not platform-side UGC.
- identification-only tier (what plyr uses today): AuDD ($5/1k requests), ACRCloud — detection with no licensing attached.

### what this means for plyr

the "Content ID troll" is really two different monsters:

1. **identification** — plyr already has this (AuDD pipeline, `docs/internal/moderation/copyright-detection.md`), used defensively: "a fingerprint match is not a finding," de-list not block. chromaprint.zig may replace AuDD.
2. **licensing/monetization** — the part Google "silently shoulders." realistic paths, in rough order of attainability:
   - (a) **current posture**: host rights-cleared/original audio, fingerprint-gate the rest, DMCA safe harbor (needs #1715's public half).
   - (b) **composition-side blankets** (MLC + 4 PROs) become relevant the moment plyr streams *covers* interactively — cheap-ish and statutory, but useless for the sound-recording problem.
   - (c) **non-interactive radio product** under §114/SoundExchange — the radio surface could in principle qualify, at the cost of the programming rules (no on-demand, playlist constraints).
   - (d) **micro-licensing intermediaries** (Pex, Audible Magic UMRP) — the only path a plyr-sized platform has toward monetize-instead-of-remove for matched content; coverage is participation-limited.
   - (e) **Mixcloud-style direct deals** — what it takes to bless DJ mixes wholesale; took Mixcloud and SoundCloud years and most of their gross margin.

the mixes currently triggering the fingerprinter with "no one mad" sit exactly in the gap Mixcloud paid to close and Pex/Dubset tried to productize.

## prior art in-repo (what existed before this doc)

- issue #705 comment (ooo.audio meeting notes, 2026-04-08): "fingerprinting → content ID" one-liner, PRO/ISRC question marks — bullets, no analysis.
- issue #167: escalation table "100+ notices/month → evaluate content id (audible magic)"; covers need mechanicals (~$0.12/copy).
- `docs/internal/legal/questions.md` Q1/Q2/Q4 and `docs/internal/legal/meetings/2026-01-03-initial.md` ask 5 — licensing explicitly deferred as a lawyer question.
- no prior writing anywhere (repo, discussions, notes) on Content ID mechanics, Meta/TikTok deals, sync, or rights-holder payout routing. fingerprinting and payments are deliberately unlinked in all current docs.

## open questions

- does plyr's radio surface, as built, satisfy §114's non-interactive definition and programming complement — or is skip/queue behavior disqualifying?
- Pex Attribution Engine's actual catalog coverage and minimum commitments for a platform this size (their public material doesn't say).
- where does attested.network/ATM fit if a rights holder (not the uploading artist) is the party owed — is a "rightsholder DID signs a rights attestation" (per `docs/internal/research/2026-05-28-dasl-muxl-s2pa.md`) composable with broker payments?
- MLC/PRO cost figures above are approximate; get real quotes before any covers-streaming decision.
