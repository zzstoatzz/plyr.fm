# Content Gating: Research Notes

Reference material for understanding ATProtoFans and preparing for upcoming discussions.

## Current State (plyr.fm)

Binary supporter check:

```python
# backend/src/backend/_internal/atprotofans.py
validate_supporter(supporter_did, artist_did, signer_did) -> bool
```

Track gating stored as:
```json
{"type": "any"}  // supporter or not, nothing else
```

## What ATProtoFans Provides Today

Based on [ATProtoFans technical docs](https://atprotofans.leaflet.pub/3m7nlsl3vxk24):

### Records

1. **Supporter Record** (fan's repo) - `com.atprotofans.supporter`
   - Links to supporterProof and brokerProof via strongRef

2. **Supporter Proof** (creator's repo) - `com.atprotofans.supporterProof`
   - Creator's attestation of the relationship

3. **Broker Proof** (broker's repo) - `com.atprotofans.brokerProof`
   - Third-party verification of the transaction

4. **Terms Record** (broker's service) - `com.atprotofans.terms`
   ```json
   {
     "$type": "com.atprotofans.terms#recurring",
     "amount": 1000,      // cents
     "currency": "USD",
     "unit": "monthly",   // monthly, quarterly, biannually, yearly
     "frequency": 1
   }
   ```

### API

```
GET /xrpc/com.atprotofans.validateSupporter
  ?supporter={did}&subject={creator_did}&signer={broker_did}

Response: { "valid": true, "profile": {...} }
```

**The gap:** Terms exist but aren't exposed via `validateSupporter`. We can only check supporter yes/no, not *which terms* they agreed to.

## What's Coming

From ATProtoFans (Jan 2026):
> "The successor is in the works that will support additional metadata and record extensions"

## JSONLogic (datalogic-rs)

Nick's [magazi](https://tangled.org/@ngerakines.me/magazi) uses [datalogic-rs](https://github.com/GoPlasmatic/datalogic-rs) for rule evaluation. Rules are JSON that evaluate against a context object.

### Context Structure

```json
{
  "authenticated": true,
  "supporter": { ... },        // supporter record
  "supporter_proof": { ... },  // from creator's repo
  "broker_proof": { ... },     // from broker's repo
  "terms": { ... }             // terms record (if exposed)
}
```

### Example Rules

**Any supporter (what we do now):**
```json
{ "!!": { "var": "supporter" } }
```

**Full attestation chain:**
```json
{
  "and": [
    { "!!": { "var": "supporter" } },
    { "!!": { "var": "supporter_proof" } },
    { "!!": { "var": "broker_proof" } }
  ]
}
```

**Minimum amount (requires terms access):**
```json
{
  "and": [
    { "!!": { "var": "supporter" } },
    { ">=": [{ "var": "terms.amount" }, 1000] }
  ]
}
```

**Supporter tenure (requires createdAt):**
```json
{
  "and": [
    { "!!": { "var": "supporter" } },
    { ">=": [
      { "date_diff": [{ "now": [] }, { "var": "supporter.createdAt" }, "days"] },
      30
    ]}
  ]
}
```

The `!!` (double-bang) checks truthiness - returns true if field exists and is non-null.

## Open Questions

1. **Terms access:** Will `validateSupporter` return terms info, or separate endpoint?

2. **Supporter metadata:** Plans for `supporterSince` or tenure data?

3. **Context fields:** What fields will be available for rule evaluation?

4. **serviceRef resolution:** Should apps resolve serviceRef to get terms, or will API surface this?

5. **Caching:** Recommended TTL for validation results?

6. **JSONLogic adoption:** Interest in standardizing rule format across ecosystem?
