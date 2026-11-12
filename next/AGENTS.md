# next

The rewrite of plyr.fm that runs beside the legacy app. The root `AGENTS.md`
applies; this adds what is specific to `next/`. Commands and deploys are in the
[readme](README.md); current state and the order of work are in the latest
handoff under [docs/research](../docs/research).

## where state lives

These follow Tangled's
[Bobbin](https://til.desertthunder.dev/notes/2026/08/01/bobbin/) and ana's
[evil atproto](https://nekomimi.leaflet.pub/3mqovvmc4jk2i). They decide where
any new feature keeps its data.

- The client writes records; the server does not. Tracks, lists, likes and
  profiles go from the client straight to the account's PDS. The appview is
  read-only: it holds no account credentials and never writes a record on
  anyone's behalf. After a write the client waits for the appview to project
  that version rather than asking the server to write it.
- Whatever the appview derives from records is disposable. Repair a missed
  event or a bad deploy by replaying from the network, not by editing rows or
  writing a one-off migration. Do not add derived state that a replay cannot
  rebuild.
- State that is not a record stays with the service that owns it and out of
  the PDS: sessions, the queue and its position, settings, metrics, moderation.
  The protocol is for identity, authorization and the user's public records,
  not for our operational state. Each such store needs a named owner and a
  recovery rule, since replay will not bring it back.
- A capability only some PDSes offer must not decide whether a basic feature
  works for an account.
- The appview serves `fm.plyr.*` and nothing else. Add a service, store or
  dependency only when the existing ones cannot do the job.

## the client

- Phone first. Judge a change on a phone-sized screen with a finger, in the
  rendered result, before shipping it. Show a mockup when the direction is a
  choice.
- One codebase for web, iOS and Android. Use cross-platform primitives and
  keep web-only code behind a small named seam.
- Next uses client-owned OAuth through its browser/native SDK adapters, unlike
  the legacy app's HttpOnly session cookies. Keep credentials inside those
  adapters; do not add auth tokens to app storage or localStorage.
- Production is the reference for look, lowercase voice, toasts, resume and
  media controls. Match it where it is good; do not redesign it.

## working here

- Records are shared with production, so keep published lexicon shapes and
  preserve fields Next does not know. Next deploys never promote production.
- Ship a backend change before the client change that depends on it.
- Browser checks sit beside the client and are not in CI. Build the web export,
  then run the checks for the area you touched, and the player set after any
  player change. A check must fail without the change and assert what the user
  sees, not a URL or a fixed wait.
- Signed-in behaviour is testable without a PDS account through the queue
  fixture, which generates identities and runs local coordinators against the
  compose Redis and Postgres.
- The API allows the configured Next origins and `http://127.0.0.1:5174`,
  not arbitrary LAN origins. For a local build on a phone, use a proxy to the
  Next API instead of broadening deployed CORS.
- An open tab keeps the build it loaded. Reload after a deploy before judging
  a fix.
