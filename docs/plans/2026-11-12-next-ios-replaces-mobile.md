# next's expo build replaces the existing iOS app

November 12, 2026. Roadmap item: the iOS app people install should be the
native build of `next/app`, not a separate client.

## what "the existing iOS app" actually is

It is not Swift. It is `mobile/`, an Expo 57 / RN 0.86 app that only exists on
unmerged branches (#2133 player, #2143 sign-in, #2142 legacy-backend native
auth; latest head `a8750b4a2`, October 12). Its only Swift is three small Expo
modules (route picker, scrubber, sheet guard).

What it owns that matters for replacement:

| Thing | Value |
|---|---|
| Bundle id | `fm.plyr` |
| App Store Connect app | `6820399998` ("plyr.fm"), team `65M396B5CL` |
| EAS project | `@zzstoatzz.io/plyr-fm`, `680fd924-087f-4ae5-8813-2fee71cb66f8` |
| Shipped | `0.1.0 (1)` to internal TestFlight ("Team (Expo)") on October 8. Never public. |

Because it never went public, "replace" means taking over the same App Store
Connect record and EAS project, not migrating users' on-device state.

## groundwork in this PR

`next/app` now builds into that slot:

- `ios.bundleIdentifier` `fm.plyr` (was `fm.plyr.next`), EAS `owner`/`slug`/
  `projectId` of the existing project, so EAS reuses its signing credentials
  and its remote build-number counter.
- `eas.json` with `simulator`, `device` (internal) and `production` profiles,
  submitting to ASC `6820399998`. Node 22 matches `npm test`'s requirement.
- App icon from `mobile/assets/icon.png`; iPhone only; export-compliance flag.
- The URL scheme stays `fm.plyr.next`: native atproto OAuth requires the
  redirect scheme to be the reverse of the `client_id` host (`next.plyr.fm`).
  Prebuild also registers `fm.plyr` from the bundle id, which is what the
  scheme becomes after the domain cutover.
- Android keeps `fm.plyr.next`; nothing here touches web output, prod code or
  workflows.

Verified on Linux: `expo config`, `expo prebuild --platform ios` (bundle id
`fm.plyr`, `UIBackgroundModes: [audio]`, no microphone string, URL schemes,
device family iPhone, 1024 icon), `npm run check`, 134 tests, `build:web`.
Nothing was compiled with Xcode in this change.

## ship path

1. On the Mac, `cd next/app && npx eas-cli build -p ios --profile production --auto-submit`.
   Same bundle id and project, so the existing distribution cert/profile apply.
   Version `1.0.0` sorts above the old `0.1.0`.
2. Install from TestFlight on a physical phone and run the device acceptance
   below. Simulator evidence exists; physical evidence does not.
3. External TestFlight (beta review), then App Store review.
4. Close #2133/#2143/#2142 as superseded and delete their branches.

## device acceptance (not yet done anywhere)

- Background audio across lock, app switch, and a long queue.
- Lock-screen/Control Center: metadata, artwork, play/pause, next/previous
  (pinned `expo-audio` patch), scrubbing. Note the web app's unresolved
  scrubber issue (#1870) is a different stack.
- Interruptions: phone call, Siri, other app audio; headphone unplug pauses;
  AirPlay/Bluetooth route changes.
- Real-account OAuth via `fm.plyr.next:/oauth/callback`, account switching,
  service-auth consent, then queue/settings sync with the web.
- Jams and radio handoffs while backgrounded.

## parity gaps vs the old app (native polish, not product)

Next already exceeds the old app in product (sign-in, likes, uploads,
playlists/albums, radio, Jams, queue sync, private music). What the old app had
that next's native build lacks:

- Preloading the next track for instant skips (old app used a second deck and
  a cache download; next uses one `expo-audio` player).
- AirPlay route picker button, sleep timer, haptics, level meter.
- Launch splash (needs `expo-splash-screen`; add with a dependency PR).
- Live Activity / widgets (only ever a draft branch).
- Universal links: `apple-app-site-association` on the web origin.

## App Store review risks

- Guideline 1.2 (user-generated content): needs in-app report and block for
  tracks/comments/users, plus a way to hide abusive content. Next has the
  moderation primitives but no report UI in the native client.
- Privacy nutrition labels and a privacy policy URL.
- Account deletion (5.1.1(v)) should not apply because accounts live on the
  user's PDS, but the review notes should say so.
- Jam/upload coordinators default to `*.fly.dev` and staging lexicon
  namespaces (`fm.plyr.stg.jam`); decide what a store build points at before
  public release.
