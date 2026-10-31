# plylst album link

Album owners can enable **show plylst link** while editing an album. It defaults
off. The owner edits a draft in album settings and presses **save changes**;
**cancel** restores saved settings. Failed saves retain the draft and show an
inline error. Only the album owner can change the setting. Link-only saves do
not start a track access job. If access changes succeed but the link save fails,
retrying saves only the link.

The public album action is plylst's favicon and an outbound arrow, with an
accessible name and tooltip. The favicon is served locally from
`frontend/static/integrations/plylst.svg` (source:
https://plylst.renderg.host/favicon.svg), so rendering the page sends no request
to plylst. Following the link opens a new tab without a referrer or opener.

The destination preserves `/u/{handle}/album/{slug}`. It is offered only for
nonempty albums whose visible tracks allow public listening and are not private.
It grants no access and sends no session credential. An owner may leave the
setting enabled while changing access; the link hides when playback is restricted.

The setting is plyr-specific metadata in `albums.show_plylst`, not a PDS rewrite.
Updates invalidate the album cache using the artist's current handle. The API
response exposes the choice as `metadata.show_plylst`.

Plylst supports public albums, not playlists, as verified on October 30, 2026.
There is no native waveform player or global experiment flag in this change.
