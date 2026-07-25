---
title: "moderation"
description: "what plyr.fm labels, what a label actually does, and how to appeal one"
---

plyr.fm publishes moderation decisions from
[@moderation.plyr.fm](https://bsky.app/profile/moderation.plyr.fm). This page
explains what those decisions mean.

## labels are assertions, not deletions

a label is a signed, public statement about a track — anyone can read them
through the AT Protocol
[`com.atproto.label.queryLabels`](https://docs.bsky.app/docs/api/com-atproto-label-query-labels)
endpoint, and any client can subscribe to plyr.fm's labeler and decide for
itself what to do with them.

what *we* do with a label on our own surfaces is a separate thing, and it is
only binding on us. Another client reading the same label is free to render it
differently.

## two kinds of label, two different rules

the difference is who gets to decide.

### adult audio — `sexual`, `porn`

a rendering default that **you** control. These are
[standard AT Protocol values](https://github.com/bluesky-social/atproto/blob/main/packages/api/definitions/labels.json),
not plyr.fm inventions.

- hidden from discovery, search, recommendations, collections, queues, and
  Subsonic browsing unless you enable **sensitive audio** in settings
- never in shared radio, for anyone — radio is one synchronized stream, so no
  single listener's preference can decide what everyone else hears
- **still listed on the artist's own page**, and **a direct link plays for
  anyone**

see [sensitive content](/sensitive-content) for the settings.

### copyright — `copyright-violation`

not a preference. plyr.fm stores and serves the audio, so acting on a credible
copyright claim is our responsibility and no listener setting can waive it.

- removed from discovery and radio for everyone
- **a direct link still plays.** A fingerprint match is not a finding — covers,
  remixes, and an artist's own catalogue all match — so being flagged does not
  break the uploader's own link
- removal from plyr.fm is a separate, deliberate decision made by a person

## where a label applies

a label changes where a track *surfaces*, not whether you can reach what you
went looking for. The distinction is between two kinds of place:

- **surfaces we choose for you** — the home feed, search results,
  recommendations, radio. Adult labels filter here.
- **places you navigated to** — an artist's page, an album, a track's own
  link. These show what is there.

this mirrors how the AT Protocol itself models moderation, where the same post
can be hidden in a feed but visible when you open it. Hiding part of an
artist's catalogue on their own page would misrepresent their work to someone
who had already gone looking for them.

copyright is the exception: it applies everywhere, because it is about what we
are willing to keep serving rather than about what you would rather see.

## what gets published, and what does not

the moderation account posts **actions we took**, never suspicions we hold.

published:

- a track removed
- a track removed from discovery and radio
- a label applied
- a label withdrawn

not published:

- a track being flagged by our copyright scanner
- a user report being filed
- a review that concluded no action was needed

the reason is the same in each case: announcing that something *might* be a
problem, before anyone has decided whether it is, marks an uploader for
something that may well turn out to be their own work. Posts never name the
uploader and never mention a reporter.

## if you think a decision is wrong

use the report control on the track, or email
[plyrdotfm@proton.me](mailto:plyrdotfm@proton.me).

decisions are reversible and reversal is recorded the same way the original
decision was. Two things can happen when we are wrong, and they mean different
things:

- **the label is withdrawn** — the assertion itself was mistaken
- **the label stands and the track is surfaced anyway** — the match was real
  but not a violation, which is the usual outcome for a cover or a remix

## federation

plyr.fm can remove a track from plyr.fm. It cannot remove it from other AT
Protocol services that may have copies, and it does not delete anything from
your own repository. Labels we publish travel to whoever subscribes to our
labeler; what those services do with them is their decision, not ours.
