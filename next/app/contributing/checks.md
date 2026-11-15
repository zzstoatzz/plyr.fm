# checks

Run these from `next/app` after installing from `next/`.

```sh
bun run lint
bun run check
bun run test
bun run expo export --platform ios --platform android
```

Launch the app in a simulator or on a device to verify gestures, audio and
lifecycle behavior. The bundle export verifies Metro and Hermes.

The Node scripts for the Jam and personal queue coordinators need the local
test services and disposable identities. Svelte browser checks live in
`next/web`. The frozen Expo release and its browser checks live on
`next-expo`.
