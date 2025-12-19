# research: Web Share Target API for iOS PWAs

**date**: 2025-12-19
**question**: can a PWA receive shared audio files from the iOS share sheet (like SoundCloud does)?

## summary

**No, iOS Safari does not support Web Share Target API.** This is a known limitation with an open WebKit bug (#194593) since February 2019 - no timeline for implementation. Android Chrome fully supports it. The SoundCloud iOS share integration you saw works because SoundCloud has a native iOS app, not a PWA.

## findings

### iOS Safari limitations

- Web Share Target API (receiving files) - **NOT supported**
- Web Share API (sending/sharing out) - supported
- WebKit bug #194593 tracks this, last activity May 2025, no assignee
- Apple mandates WebKit for all iOS browsers, so no workaround via Chrome/Firefox
- This is why plyr.fm can't appear in the iOS share sheet as a destination

### Android support

- Chrome fully supports Web Share Target since ~2019
- manifest.json `share_target` field enables receiving shared files
- Would work for Android users installing plyr.fm PWA

### current plyr.fm state

- `frontend/static/manifest.webmanifest` - basic PWA config, no share_target
- `frontend/src/lib/components/ShareButton.svelte` - clipboard copy only
- no `navigator.share()` usage (even though iOS supports sharing OUT)

### workaround options

1. **native iOS app** - only real solution for iOS share sheet integration
2. **Web Share API for outbound** - can add "share to..." button that opens iOS share sheet
3. **improved in-app UX** - better upload flow, drag-drop on desktop
4. **PWABuilder wrapper** - publish to App Store, gains URL scheme support

## code references

- `frontend/static/manifest.webmanifest` - would add `share_target` here for Android
- `frontend/src/lib/components/ShareButton.svelte:8-15` - current clipboard-only implementation

## potential quick wins

even without iOS share target support:

1. **add navigator.share() for outbound sharing** - let users share tracks TO other apps via native share sheet
2. **add share_target for Android users** - Android PWA installs would get share sheet integration
3. **improve upload UX** - streamline the in-app upload flow for mobile

## open questions

- is Android share target support worth implementing given iOS is primary user base?
- would a lightweight native iOS app (just for share extension) be worth maintaining?
- any appetite for PWABuilder/App Store distribution?

## sources

- [WebKit Bug #194593](https://bugs.webkit.org/show_bug.cgi?id=194593)
- [MDN: share_target](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest/Reference/share_target)
- [web.dev: OS Integration](https://web.dev/learn/pwa/os-integration)
- [firt.dev: iOS PWA Compatibility](https://firt.dev/notes/pwa-ios/)
