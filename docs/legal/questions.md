plyr.fm legal questions

# plyr.fm - legal questions

music streaming platform on AT Protocol. users upload audio. no payments yet.

## 1. copyright liability without licensing deals

youtube/spotify/tiktok have content ID systems and pay labels for copyrighted content on their platforms. we don't - we just respond to DMCA takedowns (registered agent, terminate repeat infringers).

**question:** is DMCA safe harbor sufficient for a user-upload music platform, or do we eventually need licensing agreements? what's the realistic legal exposure if a label decides to come after us instead of just sending takedowns?

## 2. proactive scanning implications

we run automated copyright detection (AudD) on uploads and flag matches. we don't auto-remove, just flag for review.

**question:** does proactive scanning help or hurt our legal position? does knowing about potential infringement before a takedown create additional liability, or does it strengthen our "good faith" safe harbor claim?

## 3. federation and DMCA

AT Protocol federates data to relay servers we don't control. when we receive a DMCA takedown, we remove content from plyr.fm but cannot remove it from third-party relays that already indexed it.

**question:** does inability to fully remove content from the network affect our DMCA safe harbor status? how should our ToS/response procedures address this limitation?

## 4. future paywalled content

we may add artist paywalls later (via atprotofans/graze.social as payment processor). artists would gate content to supporters.

**question:** if we facilitate paid content and take a cut, does that change our liability profile from "platform" to "distributor"? what ToS changes would we need before adding payments?

## 5. user-uploaded images

users upload album art and profile images. we run moderation for sensitive content but risk CSAM, copyright infringement, etc.

**question:** what's our liability exposure for user-uploaded images vs audio? are there additional compliance requirements (NCMEC reporting, etc.) we should implement now?
