# space access

who may read a gated space is answered in one place, `src/internal/space/access.zig`.
`checkUserAccess` and supporter downloads both go through its `Decider`; neither
knows how the answer is reached.

## the model

anything gated (a track, an album's tracks, a playlist) lives in a space,
`at://{artist}/space/{SPACE_TYPE_NSID}/{skey}`. the skey is just a name.

the artist opens a space by writing `fm.plyr.policy` records (lexicon in
`next/app/lexicons/policy.json`, collection `<track namespace>.policy`) in their
own repo. each record names one space and one rule. a space can carry any number
of policies; a reader who passes any one of them may read the whole space.

| rule | passes |
| --- | --- |
| `signedIn` | any signed-in account |
| `members` | the listed DIDs (public list, max 512) |
| `supporter` | anyone with a broker-verified `network.attested.payment` to the artist, any amount |
| `purchase` | a verified payment to the artist at or above `amount` in `currency`, whose `entitlements` include this policy record's uri |

`supporter` and `purchase` take optional `brokers`; absent means the
deployment's `SUPPORT_TRUSTED_BROKERS` (default: Atmosphere Money). payments are
read from the payer's repo and each broker proof is verified, so no single
provider is wired in.

## decision order

1. a space of another type: closed.
2. the space authority (the artist): open, read or write.
3. anyone else writing: closed.
4. otherwise the artist's policies naming this exact space uri decide.
5. a space with no policy records falls back to its legacy skey: `signed-in`
   reads as `signedIn`, `supporters` as `supporter`. anything else stays closed.

unknown rule types and malformed records are ignored (they open nothing).
lookup failures fail closed unless another policy already allowed the reader.
