# research: atprotofans paywall integration

**date**: 2025-12-20
**question**: how should plyr.fm integrate with atprotofans to enable supporter-gated content?

## summary

atprotofans provides a creator support platform on ATProto. plyr.fm currently has basic support link integration (#562). The full platform integration model allows defining support tiers with metadata that round-trips through validation, enabling feature gating. Implementation should proceed in phases: read-only badge display first, then platform registration, then content gating.

## current integration

from PR #562, plyr.fm has:
- support link mode selector in portal: none / atprotofans / custom
- eligibility check queries user's PDS for `com.atprotofans.profile/self` record
- profile page shows support button linking to `atprotofans.com/u/{did}`

**code locations:**
- `frontend/src/routes/portal/+page.svelte:137-166` - eligibility check
- `frontend/src/routes/u/[handle]/+page.svelte:38-44` - support URL derivation
- `backend/src/backend/api/preferences.py` - support_url validation

## atprotofans API

### validated endpoints

**GET `/xrpc/com.atprotofans.validateSupporter`**

validates if a user supports an artist.

```
params:
  supporter: did (the visitor)
  subject: did (the artist)
  signer: did (the broker/platform that signed the support template)

response (not a supporter):
  {"valid": false}

response (is a supporter):
  {
    "valid": true,
    "profile": {
      "did": "did:plc:...",
      "handle": "supporter.bsky.social",
      "displayName": "Supporter Name",
      ...metadata from support template
    }
  }
```

**key insight**: the `metadata` field from the support template is returned in the validation response. this enables plyr.fm to define packages and check them at runtime.

### platform integration flow

from issue #564:

```
1. plyr.fm registers as platform with did:web:plyr.fm

2. artist creates support template from portal:
   POST /xrpc/com.atprotofans.proposeSupportTemplate
   {
     "platform": "did:web:plyr.fm",
     "beneficiary": "{artist_did}",
     "billingCycle": "monthly",
     "minAmount": 1000,  // cents
     "fees": {"platform": "5percent"},
     "metadata": {"package": "early-access", "source": "plyr.fm"}
   }
   → returns template_id

3. artist approves template on atprotofans.com

4. supporter visits atprotofans.com/support/{template_id}
   → pays, support record created with metadata

5. plyr.fm calls validateSupporter, gets metadata back
   → unlocks features based on package
```

## proposed tier system

| package | price | what supporter gets |
|---------|-------|---------------------|
| `supporter` | $5 one-time | badge on profile, listed in supporters |
| `early-access` | $10/mo | new releases 1 week early |
| `lossless` | $15/mo | access to FLAC/WAV downloads |
| `superfan` | $25/mo | all above + exclusive tracks |

artists would choose which tiers to offer. supporters select tier on atprotofans. plyr.fm validates and gates accordingly.

## implementation phases

### phase 1: read-only validation (week 1)

**goal**: show supporter badges, no platform registration required

1. **add validateSupporter calls to artist page**
   ```typescript
   // when viewing artist page, if viewer is logged in:
   const validation = await fetch(
     `https://atprotofans.com/xrpc/com.atprotofans.validateSupporter` +
     `?supporter=${viewer.did}&subject=${artist.did}&signer=${artist.did}`
   );
   if (validation.valid) {
     // show "supporter" badge
   }
   ```

2. **cache validation results**
   - redis cache with 5-minute TTL
   - key: `atprotofans:supporter:{viewer_did}:{artist_did}`

3. **display supporter badge on profile**
   - similar to verified badge styling
   - tooltip: "supports this artist via atprotofans"

**frontend changes:**
- `+page.svelte` (artist): call validation on mount if viewer logged in
- new `SupporterBadge.svelte` component

**backend changes:**
- new endpoint: `GET /artists/{did}/supporter-status?viewer_did={did}`
- or: call atprotofans directly from frontend (simpler, public endpoint)

### phase 2: platform registration (week 2)

**goal**: let artists create plyr.fm-specific support tiers

1. **register plyr.fm as platform**
   - obtain `did:web:plyr.fm` (may already have)
   - register with atprotofans (talk to nick)

2. **add tier configuration to portal**
   ```typescript
   // portal settings
   let supportTiers = $state([
     { package: 'supporter', enabled: true, minAmount: 500 },
     { package: 'early-access', enabled: false, minAmount: 1000 },
   ]);
   ```

3. **create support templates on save**
   - call `proposeSupportTemplate` for each enabled tier
   - store template_ids in artist preferences

4. **link to support page**
   - instead of `atprotofans.com/u/{did}`
   - link to `atprotofans.com/support/{template_id}`

**backend changes:**
- new table: `support_templates` (artist_id, package, template_id, created_at)
- new endpoint: `POST /artists/me/support-templates`
- atprotofans API client

### phase 3: content gating (week 3+)

**goal**: restrict content access based on support tier

1. **track-level gating**
   - new field: `required_support_tier` on tracks
   - values: null (public), 'supporter', 'early-access', 'lossless', 'superfan'

2. **validation on play/download**
   ```python
   async def check_access(track: Track, viewer_did: str) -> bool:
       if not track.required_support_tier:
           return True  # public

       validation = await atprotofans.validate_supporter(
           supporter=viewer_did,
           subject=track.artist_did,
           signer="did:web:plyr.fm"
       )

       if not validation.valid:
           return False

       viewer_tier = validation.profile.get("metadata", {}).get("package")
       return tier_includes(viewer_tier, track.required_support_tier)
   ```

3. **early access scheduling**
   - new fields: `public_at` timestamp, `early_access_at` timestamp
   - track visible to early-access supporters before public

4. **lossless file serving**
   - store both lossy (mp3) and lossless (flac/wav) versions
   - check tier before serving lossless

**database changes:**
- add `required_support_tier` to tracks table
- add `public_at`, `early_access_at` timestamps

**frontend changes:**
- track upload: tier selector
- track detail: locked state for non-supporters
- "become a supporter" CTA with link to atprotofans

## open questions

1. **what is the signer for existing atprotofans supporters?**
   - when artist just has `support_url: 'atprotofans'` without platform registration
   - likely `signer` = artist's own DID?

2. **how do we handle expired monthly subscriptions?**
   - atprotofans likely returns `valid: false` for expired
   - need to handle grace period for cached access?

3. **should lossless files be separate uploads or auto-transcoded?**
   - current: only one audio file per track
   - lossless requires either: dual upload or transcoding service

4. **what happens to gated content if artist disables tier?**
   - option A: content becomes public
   - option B: content stays gated, just no new supporters
   - option C: error state

5. **how do we display "this content is supporter-only" without revealing what's behind it?**
   - show track title/artwork but blur?
   - completely hide until authenticated?

## code references

current integration:
- `frontend/src/routes/portal/+page.svelte:137-166` - atprotofans eligibility check
- `frontend/src/routes/u/[handle]/+page.svelte:38-44` - support URL handling
- `backend/src/backend/api/preferences.py` - support_url validation

## external references

- [atprotofans.com](https://atprotofans.com) - the platform
- issue #564 - platform integration proposal
- issue #562 - basic support link (merged)
- StreamPlace integration example (from nick's description in #564)

## next steps

1. **test validateSupporter with real data**
   - find an artist who has atprotofans supporters
   - verify response format and metadata structure

2. **talk to nick about platform registration**
   - requirements for `did:web:plyr.fm`
   - API authentication for `proposeSupportTemplate`
   - fee structure options

3. **prototype phase 1 (badges)**
   - start with frontend-only validation calls
   - no backend changes needed initially
