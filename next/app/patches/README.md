# native audio patch

`expo-audio+58.0.11.patch` adds iOS next/previous events to Expo's single
`AudioPlayer`. Install with `bun install --frozen-lockfile` from `next/`. Bun applies the patch during install. A native rebuild is required after changing the patch.

Expo keeps ownership of `MPRemoteCommandCenter`, metadata, seeking and playback.
The app handles the new events through its existing personal queue and Jam
commands. No native playlist or second queue is introduced. Web and Android
do not subscribe to these iOS events.

Before upgrading Expo Audio, check its `AudioPlayer` remote-command support.
If upstream provides the events, migrate the hook and remove this patch and its `patchedDependencies` entry. Otherwise regenerate the patch against the explicitly pinned
version, then run the app checks and rebuild iOS. Verify next, previous/restart,
queue boundaries, source changes, radio suspension, remote output ownership,
Jam permission/disconnect changes and logout. Keep physical lock-screen,
headset and interruption acceptance separate from simulator or bundle checks.
