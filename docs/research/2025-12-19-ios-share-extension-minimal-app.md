# research: minimal iOS app with share extension

**date**: 2025-12-19
**question**: how to build a minimal iOS app with share extension for uploading audio to plyr.fm API, for someone with no iOS experience

## summary

**yes, it's doable.** native Swift is the best approach - simpler than cross-platform for this use case. you need a minimal "host app" (Apple requires it) but it can just be login + settings. the share extension does the real work. estimated 4-8 weeks for someone learning Swift as they go.

## the reality check

| requirement | detail |
|-------------|--------|
| cost | $99/year Apple Developer account + Mac |
| timeline | 4-8 weeks (learning + building) |
| complexity | medium - Swift is approachable |
| app store approval | achievable if main app has real UI |

## architecture

```
plyr-ios/
├── PlyrApp/                 # main app target (~200 lines)
│   ├── AuthView.swift       # OAuth login
│   ├── SettingsView.swift   # preferences
│   └── ProfileView.swift    # account info
│
├── PlyrShareExtension/      # share extension (~300 lines)
│   ├── ShareViewController.swift
│   └── AudioUploadManager.swift
│
└── PlyrShared/              # shared code
    ├── APIClient.swift      # HTTP requests
    ├── KeychainManager.swift # token storage
    └── Constants.swift
```

## how it works

1. **user installs app** → opens once → logs in via OAuth
2. **token stored** in iOS Keychain (shared between app + extension)
3. **user records voice memo** → taps share → sees "plyr.fm"
4. **share extension** reads token from Keychain, uploads audio to API
5. **done** - no need to open main app again

## key constraints

| constraint | value | implication |
|------------|-------|-------------|
| memory limit | ~120 MB | stream file, don't load into memory |
| time limit | ~30 seconds | fine for most audio, use background upload for large files |
| extension can't do OAuth | - | main app handles login, extension reads stored token |

## authentication flow

```
Main App:
1. User taps "Log in with Bluesky"
2. OAuth flow via browser/webview
3. Receive token, store in shared Keychain

Share Extension:
1. Check Keychain for token
2. If missing → "Open app to log in" button
3. If present → upload directly to plyr.fm API
```

## two implementation paths

### path A: direct upload (simpler, 4-6 weeks)

- extension uploads file directly via URLSession
- shows progress UI in extension
- good for files under ~20MB
- risk: 30-second timeout on slow connections

### path B: background upload (robust, 6-8 weeks)

- extension saves file to shared container
- hands off to background URLSession
- main app can show upload queue
- handles large files, retries on failure
- professional quality

**recommendation**: start with path A, upgrade to B if needed.

## app store approval

Apple requires the main app to have "independent value" - can't be empty shell. minimum viable:
- login/logout UI
- settings screen
- profile/account view
- maybe upload history

this is enough to pass review. many apps do exactly this pattern.

## what you need to learn

1. **Swift basics** - 1-2 weeks of tutorials
2. **SwiftUI** - for building UI (modern, easier than UIKit)
3. **URLSession** - for HTTP requests
4. **Keychain** - for secure token storage
5. **App Groups** - for sharing data between app + extension

## example code: share extension upload

```swift
class ShareViewController: SLComposeServiceViewController {
    override func didSelectPost() {
        guard let item = extensionContext?.inputItems.first as? NSExtensionItem,
              let attachment = item.attachments?.first else { return }

        attachment.loadFileRepresentation(forTypeIdentifier: "public.audio") { url, error in
            guard let url = url else { return }

            // Get auth token from shared Keychain
            let token = KeychainManager.shared.getToken()

            // Upload to plyr.fm API
            APIClient.shared.uploadTrack(fileURL: url, token: token) { result in
                self.extensionContext?.completeRequest(returningItems: nil)
            }
        }
    }
}
```

## plyr.fm specific considerations

- **OAuth**: plyr.fm uses ATProto OAuth - need to handle in main app
- **API endpoint**: `POST /api/tracks/upload` (or similar)
- **token refresh**: share extension should handle expired tokens gracefully
- **metadata**: could add title/artist fields in share extension UI

## alternative: iOS Shortcuts

if native app feels too heavy, you could create a Shortcut that:
1. user selects audio file
2. shortcut calls plyr.fm upload API
3. user shares shortcut via iCloud link

**pros**: no app store, no $99/year
**cons**: users must manually install shortcut, less discoverable, clunkier UX

## open questions

- does plyr.fm API support multipart file upload from iOS?
- what metadata should share extension collect? (title, tags, etc.)
- should extension show upload progress or dismiss immediately?
- worth building Android version too? (share target works there)

## learning resources

- [Apple: App Extension Programming Guide](https://developer.apple.com/library/archive/documentation/General/Conceptual/ExtensibilityPG/Share.html)
- [AppCoda: Building Share Extension](https://www.appcoda.com/ios8-share-extension-swift/)
- [Hacking with Swift: 100 Days of SwiftUI](https://www.hackingwithswift.com/100/swiftui) (free)
- [Stanford CS193p: iOS Development](https://cs193p.sites.stanford.edu/) (free)
