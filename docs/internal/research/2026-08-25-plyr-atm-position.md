# plyr × ATM: position going into the first integration call

*2026-08-25 — prep for meeting with Joe (atmosphere.money). Context: discussion #1722, design issue #1871, ATM docs (llms.txt, payment-lifecycle, checkout, read 8/16 and 8/25).*

## the one-sentence position

plyr will happily be a first-class ATM app — expose the support button, initiate checkout, fulfill from verified events, read and respect attestations — but plyr never writes payment records, and never holds a standing credential that could. The payer record belongs to ATM's own OAuth grant with the payer.

## vocabulary

attested.network (Nick Gerakines' spec) splits one attestation across three repos:

- **payer record** — `network.attested.payment.{oneTime,recurring}`, in the *supporter's* PDS. This is the attestation; "payer" names whose repo it lives in.
- **broker proof** — `network.attested.payment.proof` in the broker's repo (`broker.atmosphere.money`), `{cid, status: "verified"}` pointing at the payer record.
- **creator proof** — optional, in the artist's PDS, written only on the artist's explicit dashboard grant.

Attestations are worth reading because who-wrote-it maps to who-had-authority-to-say-it. Verification is one link: check the payer record against the broker proof.

## the flow plyr wants (the atprotofans shape)

1. Listener hits a support-gated track.
2. plyr shows a button. The button opens a **separate ATM OAuth/checkout flow**.
3. The user consents to ATM; ATM processes payment and **ATM writes the payer record to the user's PDS under ATM's grant**.
4. Redirect back to plyr; plyr reads the record, verifies the broker proof, and unlocks per the artist's policy (stream / download / whatever).

Joe has already agreed this route works: "we could just have the subscription be paid in ATM entirely and that attestation is read in plyr like you described. And plyr.fm wouldn't have to write anything... Definitely can just do the read/respect route too."

This slots into the seam already built for it: `viewer_is_supporter` behind `validate_supporter` (`backend/_internal`), which the downloads-policy schema (#1841) was deliberately kept ignorant of. atprotofans stays as one branch inside that function; attested records become another.

## the flow plyr declines, and why

Joe's smoother variant: plyr writes the payer record itself using its existing OAuth session, so the first payment has no secondary ATM OAuth. Declined, on three grounds:

**Where is the session stored?** That question is the whole disagreement. In the smooth variant, the stored thing is plyr's own OAuth session, scope-upgraded to `repo:network.attested.payment.*`, sitting in plyr's database between purchases — a standing write capability to a payments namespace, exercised on webhook events rather than on the user's explicit auth action. That is stored-session-as-consent with a payments label. In the flow above, the durable grant is user↔ATM, held by ATM and the PDS's OAuth provider; plyr stores nothing payment-related except its own fulfillment/read state. Bandcamp analogy: the saved card lives with the payment processor, not the storefront.

**Authorship = authority.** #1722's stance is verifier, not broker. If plyr authors payment claims into users' repos, it becomes a party to the payment trail, asserting transactions it did not process. And if the ecosystem norm becomes "whatever managing app has a session writes the record," a payer record tells a verifier nothing until it audits which of N apps wrote it. Broker-writes-proofs keeps the trust chain one link long.

**The friction being shaved is illusory.** It's authorization friction, not payment friction — and it is the good kind: it happens once, at the trust-establishing moment, with the right party. A later OAuth flow against an existing live ATM grant is a redirect bounce, not a re-consent. Same shape as plyr's teal and dev-token scope-upgrade flows. Even a fresh flow per purchase is acceptable for the MVP. After the first purchase the UX difference rounds to zero; the smooth variant just relocates a payments-write credential into every managing app's session store.

Note (own correction): progressive scope upgrade means plyr *could* acquire the scope at intent time without burdening every login — the argument is not "can't," it's "shouldn't want to." Writing proof-of-payment is the broker's entire job; it is what a service like ATM is *for*.

A future explicit **payer-consented delegation** mechanism (the `registerPayerRecord` shape, where the payer delegates that one write in-flow with its own consent step) would not be the anti-pattern — the objection is to repurposing plyr's music-scoped grant, not to delegation with real consent.

## mechanics to respect (from ATM's own docs)

- Never fulfill from the redirect. Fulfillment truth = verified webhook (raw-body signature) or ATM service-auth XRPC event, deduped by delivery id.
- Proof-writing is async and retryable; the payer record can lag the payment. For the "redirect back and it plays" moment, confirm via the payment event or `payment.status`, and treat the repo record as the durable, portable truth reconciled against.
- Record policy is per-payment and can be fully private — repo reads only cover public-policy payments. Cross-app subscriptions plyr should see (e.g. started in Supper) need a public-or-shared policy; worth confirming with Joe.
- Per-artist opt-in is enforced at the broker: `requestRecipientApproval` scopes plyr to a creator DID; `getPayoutStatus` gates whether plyr shows any pay surface. This satisfies #1722's "artist's choice, visible as such."
- Do not extend `network.attested.*`; app-specific contracts are `money.atmosphere.*`.
- SDK is Node-only; plyr speaks XRPC directly per the service-auth cookbook.

## scope for the MVP

In: support-gated tracks, the button, ATM-hosted checkout, event-driven fulfillment state, attested-record reads (+ existing atprotofans branch), artist opt-in via ATM approval.

Out for now: spaces (agreed with Joe — "no need to complicate things rn"), memberships (revisit later; note plyr's private-media model — authority answers per credential, membership never stored — is already the shape ATM memberships would migrate to), payer-record delegation, per-track vs per-artist policy details.
