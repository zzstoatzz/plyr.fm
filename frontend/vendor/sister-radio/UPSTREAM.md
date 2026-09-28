# sister-radio source

Source: https://tangled.org/zzstoatzz.io/plyr-radio
Forked from https://tangled.org/okami.mom/sister-radio.
Pinned fork revision: 545d38e0e9538eafb924b015c390d5708b0bf20f.

The SolidJS radio page and its CSS are retained here. The host integration supplies
plyr.fm playback, station schedules, session-authenticated presence, and appearance
settings; upstream standalone networking and audio ownership are disabled in host
mode. This is a source integration, not a second Svelte implementation of the UI.

All files under `frontend/` and `catalog/` are copied unchanged from that revision.
Only the listener page's import dependency closure is retained. `host.tsx` and
`host.css` are plyr-owned: mounting, CSS isolation, token mapping, and keyboard
event containment. Native state conversion lives in `src/lib/sister-radio.ts`.

The fork retains its standalone behavior when no integration prop is passed.
Build its frontend before updating this pin, then run plyr's mounted component
suite and inspect the desktop/mobile UI. Do not replace this source with a
separate rendering of its appearance.
