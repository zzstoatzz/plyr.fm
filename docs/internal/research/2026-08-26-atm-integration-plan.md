# plyr × ATM: integration plan (post-allowlist)

*2026-08-26 — follows the position doc (`2026-08-25-plyr-atm-position.md`) and the 8/25 call with Joe. Design issue: #1871. Waiting on: Joe adding plyr's DID to the ATM allowlist (expected end of week), plus his slide deck / blog post.*

## settled on the call

- Checkout-based authorization: ATM's hosted checkout owns the OAuth relationship with the payer and writes the payer record. plyr writes no payment records, holds no payments-scoped credential.
- No app fee stacking: ATM charges no fee beyond Stripe processing; plyr configures its own fee (0) via XRPC once allowlisted.
- Spaces are out of scope for the MVP; R2 stays the gated-blob store for now.
- The API will have breaking changes over the coming days — we integrate anyway to find rough edges and feed back.

## phase 0 — verification core (shippable now, no allowlist needed)

The choke point already exists: `validate_supporter` in `backend/_internal/atprotofans.py`, consumed by `api/audio.py` (stream + download gates) and `api/albums/downloads.py`, feeding `viewer_is_supporter` into `download_refusal` (`utilities/downloads.py`). The #1841 schema was deliberately kept ignorant of *how* supporter standing is determined — this is the seam.

- Restructure `validate_supporter` into a neutral supporter-verification module with two branches (no adapter layer; the function boundary is the abstraction):
  1. **attested records**: read `network.attested.payment.{oneTime,recurring}` from the viewer's PDS where `subject` = artist DID; verify the `signatures` entry against the broker proof (`network.attested.payment.proof`) in the broker's repo by CID, brokers checked against a trusted-broker allowlist in settings (initially `did:plc:7srqsetux75b6flzbbyag2ro` = broker.atmosphere.money). Respect record policy: private-policy payments simply won't appear here — that's correct, not a gap.
  2. **atprotofans** `validateSupporter`: kept as-is; delete when the service dies.
- Same Redis cache shape (5-minute TTL per supporter/artist pair, negative results included).
- Tests: round-trip fixtures for a valid record + broker proof, a record with no proof, a proof from an untrusted broker, recurring vs oneTime.

This alone makes cross-app support (e.g. a subscription started in Supper) light up in plyr with zero ATM registration.

## phase 1 — ATM app plumbing (once allowlisted, test mode)

- **Registration**: sign in with plyr's app DID, register app URL + backend receiver, payment mode = direct payments to creators, app fee 0.
- **Receiver**: HTTP webhook endpoint (simplest fit for FastAPI on Fly). Verify signature over the exact raw body; check event type + API version; dedupe by delivery id before acting. New tables: delivery-id dedupe + fulfillment state (payments/subscriptions plyr has verified). Never fulfill from the redirect.
- **XRPC client**: small internal module speaking ATM XRPC with app service-auth per the service-auth cookbook (SDK is Node-only; we go direct). Needed calls to start: `payment.status`/`lookup`, `money.atmosphere.payment.listSubscriptions`, `money.atmosphere.actor.getPayoutStatus`, `money.atmosphere.app.requestRecipientApproval`.
- **Exercise in test mode** with ATM's signed webhook fixtures before any real surface exists.

## phase 2 — artist opt-in + checkout

- **Portal**: "enable support via ATM" in artist settings → `getPayoutStatus` check → `requestRecipientApproval` (scoped to the artist DID + payment types) → artist approves in their ATM dashboard. No pay surface renders for an artist who hasn't completed this.
- **Checkout initiation**: server-side endpoint that builds the `atm.checkout.v1` envelope (`subscription` first; `tip` close behind), `payerDid` hint from the session, `returnUrl` back to the track/artist page. Envelope construction and secrets stay server-side.
- **The gate UX**: non-supporter hits a supporter-gated track → button → ATM hosted checkout (ATM handles its own OAuth with the payer) → redirect back → plyr confirms via the verified event or a `payment.status` lookup for the instant unlock, with the attested record as the durable truth the cache reconciles against (proof-writing is async and can lag the payment).
- **Subscription currency**: lifecycle events (`subscription.invoice-paid/updated/canceled/payment-failed/recovered`) update fulfillment state; periodic `listSubscriptions` reconciliation as backstop.

## phase 3 — policy surfaces

- Artist-configurable policy on what support unlocks (stream vs download), extending the #1841 `supporters` download policy rather than inventing a parallel one; per-track vs per-artist granularity decided here.
- Supporter badge on profiles/tracks where the artist opts in.
- Early access (#642) becomes decidable once real supporter relationships exist.

## non-goals (this arc)

- plyr writing any `network.attested.*` or `money.atmosphere.*` record.
- Spaces / memberships (revisit when ATM memberships and PDS spaces converge; plyr's authority-answers-per-credential model is already the target shape).
- atcash / individual track purchases (`shop` type) — after subscriptions work.
- Holding any ATM payer-side OAuth session.

## open items

- Record policy defaults for subscriptions plyr should read cross-app (public vs private) — ask Joe when the docs arrive.
- Which events exist in the current API vs the breaking changes Joe mentioned — pin against his deck/blog post before building the receiver.
- New API surface (checkout initiation endpoint, webhook receiver, portal section) needs nate's sign-off on shape before implementation.
