# permissioned data SDK snapshot

These ten archives are copied byte-for-byte from ZDS revision
`ebb84af92d75d7a531c7ba7a321989e491ff4690`, `tools/space-sdk/vendor/`.
Its commit `c840480ec3cf43c38e4343ea861e24e3e4cfc2fa` records that they were
built and packed from bluesky-social/atproto's permissioned-data revision
`2d4a6736f5ce0202945c5fb794486d3d78d1f85d`. The original source is available at
https://github.com/bluesky-social/atproto/tree/2d4a6736f5ce0202945c5fb794486d3d78d1f85d.

The source revision's `packages/space/src/{kem,mac,http-signature}.ts` and
`tests/kem.test.ts` define the wire contract verified here. These are prebuilt
upstream artifacts, not a claim of a locally reproduced build. `SHA256SUMS`
records the bytes copied from ZDS; package-lock.json additionally checks archive
integrity during installation. No npm release carries this contract: space 0.0.1
is unpublished, and several workspace versions collide with older npm releases.
All ten packages therefore resolve to this compatible snapshot through overrides.

To update, select a reviewed upstream revision and its matching ZDS interop
snapshot, verify archive hashes and source contract, then run the client checks,
web/iOS exports, Python MAC tests and live ZDS integration. Do not substitute a
published package solely because its version matches. Remove the vendor closure
when a verified published SDK supports this contract.

`node scripts/generate-space-mac-vectors.mjs` regenerates the Python interop
fixture with these SDK archives. The fixed HPKE key/vector comes from upstream's
`kem.test.ts` (independently computed using Go crypto/hpke); it is test data.
