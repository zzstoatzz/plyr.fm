---
title: "Zig v1 artist resource"
---

## endpoint

`GET /v1/artists/{identifier}` resolves a public artist by canonical DID or by
their current handle. One resource replaces the Python API's separate
`/artists/{did}` and `/artists/by-handle/{handle}` routes while retaining the
flat profile fields the current frontend consumes.

The endpoint returns:

- `200` for an active artist in the public projection;
- `400 invalid_request` when the identifier is neither a valid DID nor handle;
- `404 not_found` for a missing or deactivated artist;
- `500 internal_error` when the projection violates an identity invariant;
- `503 service_unavailable` when the index is unavailable.

Every response uses the common request-ID, error-envelope, method, and CORS
behavior established for `/v1`.

## identity and aliases

The DID is the artist's canonical portable identity. A handle is a mutable,
case-insensitive alias used only to resolve that DID. The application layer
normalizes handles before reaching an index adapter.

The legacy schema does not enforce case-insensitive handle uniqueness. The
Postgres adapter therefore reads at most two matches and reports an invariant
failure if an alias resolves to more than one active DID. Returning an arbitrary
row would turn corrupt projection state into an identity claim.

## authority and compatibility

The response retains these current-client fields at the top level:

- `did`, `handle`, `display_name`, `bio`, and `avatar_url`;
- `show_liked_on_profile` and `support_url`;
- `created_at` and `updated_at`.

That shape is compatibility, not an authority claim. The response also exposes
`sources` and `projection` so callers can distinguish the current transitional
state:

| field group | current source |
|---|---|
| identity | legacy Postgres projection |
| profile | legacy Postgres projection |
| public preferences | legacy app-local state |
| projection verification | legacy, unverified |

The adapter deliberately omits `pds_url` and other storage topology. A PDS
location is resolution metadata, not part of an artist's public identity.
Future verified repository ingestion can change the source and verification
values without changing the useful profile fields or the route.

## adapter boundary

`ArtistStore` accepts only a typed DID-or-handle identifier and returns the
public artist read model. The initial Postgres adapter is the only layer that
knows the existing `artists` and `user_preferences` tables. It:

1. borrows the catalog's existing connection pool rather than opening another
   Neon pool;
2. filters deactivated accounts before they cross the application boundary;
3. validates projected DIDs and handles with `zat`;
4. copies row data into the request arena before releasing the query result;
5. treats ambiguous handles and malformed identity data as corruption rather
   than temporary unavailability.

This permits the projection schema and ingestion path to be replaced without
changing the REST application or binding the domain model to legacy tables.

## intentionally open

Artist tracks, albums, follows, search, account management, profile writes, and
viewer-specific state remain separate capabilities. They should compose around
the canonical DID rather than expanding this detail route into the legacy
artist controller.
