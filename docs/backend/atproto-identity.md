# ATProto identity and OAuth

## what is DID PLC?

[PLC (Public Ledger of Credentials)](https://plc.directory) is ATProto's decentralized identifier system.

key properties:
- **self-authenticating**: cryptographically secure without blockchain
- **strongly consistent**: centralized directory for fast lookups
- **recoverable**: supports key rotation
- **portable**: users can migrate between PDS instances while keeping their DID

## resolving PDS from DID

each user's data lives on a specific PDS. to find it:

```bash
curl -s "https://plc.directory/did:plc:xbtmt2zjwlrfegqvch7fboei" | \
  jq -r '.service[] | select(.type == "AtprotoPersonalDataServer") | .serviceEndpoint'
# output: https://pds.zzstoatzz.io
```

plyr.fm caches resolved PDS URLs in `artists.pds_url` to avoid repeated lookups.

## OAuth client registration

ATProto OAuth uses **client metadata discovery** - there is no central registry to register with.

### how it works

1. **client ID is a URL**: your `ATPROTO_CLIENT_ID` must be a publicly accessible HTTPS URL that serves client metadata JSON
2. **backend serves metadata**: plyr.fm serves this at `/oauth-client-metadata.json` on the API domain
3. **automatic discovery**: when users authenticate, their PDS fetches the client metadata from your client ID URL

### configuration per environment

**production**:
- `ATPROTO_CLIENT_ID=https://api.plyr.fm/oauth-client-metadata.json`
- `ATPROTO_REDIRECT_URI=https://api.plyr.fm/auth/callback`

**staging**:
- `ATPROTO_CLIENT_ID=https://api-stg.plyr.fm/oauth-client-metadata.json`
- `ATPROTO_REDIRECT_URI=https://api-stg.plyr.fm/auth/callback`

**local development**:
- `ATPROTO_CLIENT_ID=http://localhost:8001/oauth-client-metadata.json`
- `ATPROTO_REDIRECT_URI=http://localhost:8001/auth/callback`

### important notes

- **no pre-registration needed**: unlike traditional OAuth, you don't register with a central service
- **no client secret**: ATProto OAuth uses PKCE (Proof Key for Code Exchange) instead
- **URL must be publicly accessible**: the client ID URL must be reachable by any PDS on the network
- **metadata is cached**: PDSs may cache your client metadata, so changes can take time to propagate

### verifying your setup

check that your client metadata is accessible:

```bash
curl https://api.plyr.fm/oauth-client-metadata.json
```

should return JSON with your OAuth configuration including redirect URIs and scopes.

## references

- [PLC directory](https://plc.directory)
- [ATProto identity spec](https://atproto.com/specs/did-plc)
- [ATProto OAuth spec](https://atproto.com/specs/oauth)
- [OAuth client metadata draft](https://datatracker.ietf.org/doc/html/draft-parecki-oauth-client-id-metadata-document)
