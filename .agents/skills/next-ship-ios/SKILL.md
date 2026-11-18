---
name: next-ship-ios
description: Ship next/app to nate's iPhone — an over-the-air update for JS-only changes, or a local build on nate's mac uploaded straight to TestFlight — and say "it's on your phone" only after App Store Connect shows the build available to testers. Use whenever a next/app change should reach TestFlight or installed builds.
metadata:
  author: zzstoatzz
---

# next-ship-ios

`next/app` ships to one place: the `fm.plyr` app (App Store Connect app `6820399998`) in TestFlight,
internal group "Team (Expo)", which receives every build automatically. Merged next work has
standing approval to ship; production (`just release`) is unrelated and not touched here.

## the one rule about words

"Shipped", "in TestFlight" and "on your phone" mean one thing: `scripts/testflight.mjs wait <n>`
exited 0, so App Store Connect shows build `n` as `VALID` and `IN_BETA_TESTING`. Until then, say
exactly where it is: "compiling", "uploading", "Apple is processing 49". Never report a build from
the output of `eas build`, `eas submit` or `altool` alone, and never call an over-the-air update a
build ("build 48 got an update", not "TestFlight build 48 update"). If a step can't be checked, say
it wasn't checked.

Keep the user's thread down to two messages per ship: none while it's in flight, one when it's on
the phone (or failed). A stuck stage after its normal time (table below) is a blocker; say so once,
with what you're doing about it.

## running it on the mac

Builds and uploads run on nate's mac through Remote Control (folder `~/tangled.org`). Never ask
nate to run a command. If the mac's safety check wants nate's own yes for the upload, ask once
with a decision card and keep everything else moving (build, validate) while it waits.

## 1. pick the path

From a fresh worktree of `origin/main` (never the shared checkout; another thread may be building):

```sh
git -C ~/tangled.org/zzstoatzz.io/plyr.fm fetch origin main
git -C ~/tangled.org/zzstoatzz.io/plyr.fm worktree add --detach ~/tangled.org/plyr-ship-$(date +%s) origin/main
cd <worktree>/next && bun install --frozen-lockfile && cd app
npx --no-install expo-updates fingerprint:generate --platform ios | jq -r .hash   # ~3 s
git tag -l 'next-ios/*' --sort=-v:refname | head -1                   # last shipped build
```

Compare with the fingerprint at that tag (generate it in the same way from a worktree of the
tag). Same hash → **OTA**. Different, or a new native module / config plugin / `app.json` /
`patches/` change → **build**. When unsure, build: an OTA for a runtime no installed build has
reaches nobody.

Before either: the change is merged and green, and native gesture/UI work has had its simulator
pass on the shared `plyr-claude` device (see `next-write-ui`).

## 2a. OTA (JS and assets only)

```sh
eas update --channel production --message "<what changed>" --non-interactive
```

Check the printed runtime version equals the fingerprint of the newest `next-ios/*` build. It
reaches phones on the next cold launch (close and reopen the app). Report it as an update to build
`n`, with the update group id.

## 2b. build, upload, wait

Only one build at a time on the mac: check
`ps -axo pid,etime,command | grep -E 'eas build|xcodebuild|altool' | grep -v grep` first, and
coordinate with the thread that owns a running one instead of starting a second.

```sh
LANG=en_US.UTF-8 eas build --platform ios --profile production --local --non-interactive \
  --output ./build.ipa                                   # ~6-7 min
unzip -p build.ipa 'Payload/*.app/Info.plist' | plutil -extract CFBundleVersion raw -   # = n
node scripts/testflight.mjs upload ./build.ipa           # validate + upload, ~1-3 min
node scripts/testflight.mjs wait <n>                     # Apple processing, usually 5-15 min
git tag next-ios/<n> && git push origin next-ios/<n>     # only after wait succeeds
```

`LANG=en_US.UTF-8` is required or `pod install` fails. `eas.json` uses a remote build number with
`autoIncrement`, so every `eas build` start consumes a number even if it's stopped; a skipped number
in TestFlight is expected, just say which numbers were burned.

Upload with `testflight.mjs upload`, not `eas submit`: on 2026-11-18 build 49's EAS submission sat
in Expo's queue for 15+ min with no logs while earlier ones took 15 s, and EAS retries for up to
24 h. The script uses the same App Store Connect key EAS holds, fetched with the `eas login`
session and passed to `altool` in memory, so nothing new needs setting up. `eas submit` is a
fallback only.

| stage | normal | treat as stuck after |
|---|---|---|
| `eas build --local` | 6-7 min | 20 min |
| `altool` validate + upload | 1-3 min | 10 min |
| ASC first shows the build | 1-5 min after upload | 15 min |
| `PROCESSING` → `VALID` + `IN_BETA_TESTING` | 5-15 min | 45 min (`wait` times out) |

`wait` fails fast on `INVALID`/`FAILED` and on `MISSING_EXPORT_COMPLIANCE` (`app.json` sets
`usesNonExemptEncryption: false`, so that one means the config regressed).

## 3. report, then clean up

One message: the build number, what's in it, and that it's in TestFlight for "Team (Expo)" as of
`wait`'s timestamp. Then remove the worktree and `build.ipa`, and stop any simulator, Metro or log
stream you started. `node scripts/testflight.mjs status` answers "what's actually in TestFlight"
any time.
