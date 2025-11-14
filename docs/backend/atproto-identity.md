# DID PLC and PDS resolution

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

## references

- [PLC directory](https://plc.directory)
- [ATProto identity spec](https://atproto.com/specs/did-plc)
