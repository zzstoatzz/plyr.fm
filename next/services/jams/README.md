# Jams room foundation

The host publishes the room snapshot in a private member Space. Guests write commands to their own repos within that Space. A host must verify the writer and record, check current membership, and serialize accepted commands against the snapshot revision. The reducer owns playback position and revision transitions. Room records live on the PDSes.

Run the reducer tests with Node 22:

```sh
node --experimental-strip-types --test next/services/jams/room.test.mts
```

The integration probe uses two disposable Spaces alpha PDSes on ports 5297 and 5298, sharing a local PLC directory. Install the locked dependencies in `next/app` first, then run:

```sh
node --experimental-strip-types next/services/jams/probe-space.mjs
```

The probe uses fixture membership for the reducer and checks credential renewal against the PDS. It exercises cross-PDS discovery, verifies record CIDs and MACs, rejects a replay, and reads the resulting host snapshot from the guest. Its discovery timing starts after the guest write returns on localhost.

The running app still needs OAuth integration, live membership checks, reconnect and command delivery, host writer fencing, and speaker handoff. The revision guard assumes one serialized host writer. Test those paths with separate authenticated browser sessions before exposing Jams in Next.
