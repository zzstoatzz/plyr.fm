# shared

`plyr-shared`: plain TypeScript decisions both clients import. No DOM, no React
Native, no `URL` (Hermes lacks parts of it), no I/O beyond what a caller passes in.

- Every rule the web app also has is tested against the web's own module; add
  the parity test when you add the rule.
- `contract.test.ts` checks each field a schema reads against
  `docs/internal/contracts/client-api.json`. Reading a new field means it must be
  in that baseline.
- The album routes (`/albums/{handle}`, `/albums/{handle}/{slug}`) are not in
  that baseline, so `ArtistAlbum` and `AlbumMetadata` are checked against the
  field names in `backend/src/backend/api/albums/schemas.py` instead. Move them
  to the baseline check when the routes are added to it.
- `bun run check` here: `tsc` and `bun test`.
