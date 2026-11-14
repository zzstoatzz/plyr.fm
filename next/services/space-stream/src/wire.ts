import { z } from "zod";

// Everything that crosses the network is parsed here, once, before anything else reads it.

const segment = z.string().regex(/^[^/\s]+$/);
const did = z.templateLiteral(["did:", z.string().regex(/^[a-z]+$/), ":", z.string().regex(/^[A-Za-z0-9._:%-]+$/)]);
const token = z.string().min(1).max(4096);
const name = z.string().regex(/^[^./\s]+$/);
// at://<authority>/space/<space type nsid>/<key>
export const spaceUri = z.templateLiteral(["at://", did, "/space/", name, ".", name, ".", segment, "/", segment]);
export type Did = z.infer<typeof did>;
export type SpaceUri = z.infer<typeof spaceUri>;

export function authorityOf(space: SpaceUri): Did {
  return did.parse(space.slice("at://".length, space.indexOf("/space/")));
}

// What a consumer lends: single-use bearer tokens addressed to the space authority. Whoever holds
// them can redeem them, which is what lets a syncer with no user sessions act for a consumer.
export const lent = z.object({ delegationToken: token, clientAttestation: token.optional() });
export type Lent = z.infer<typeof lent>;

export const renewal = lent.extend({ space: spaceUri });

export const subscription = z.object({
  space: spaceUri,
  delegationToken: token,
  clientAttestation: token.optional(),
  cursor: z.coerce.number().int().nonnegative().default(0),
  collections: z.array(z.string().min(1)),
});

// A subscription is Jetstream's query (`cursor`, repeated `wantedCollections`) plus the space and
// the lent tokens.
export function readSubscription(url: URL) {
  return subscription.safeParse({
    space: url.searchParams.get("space"),
    delegationToken: url.searchParams.get("delegation"),
    clientAttestation: url.searchParams.get("attestation") ?? undefined,
    cursor: url.searchParams.get("cursor") ?? undefined,
    collections: url.searchParams.getAll("wantedCollections"),
  });
}

export const REPO_WRITE = "com.atproto.space.defs#repoWrite";
export const REPO_REMOVED = "com.atproto.space.defs#repoRemoved";
export const REGISTRATION_EXPIRED = "com.atproto.space.notifySpaceUpdate#registrationExpired";
export const SPACE_DELETED = "com.atproto.space.notifySpaceUpdate#spaceDeleted";

const registration = { space: spaceUri, token: z.string().min(1).max(512) };
export const confirmation = z.object({ ...registration, challenge: z.string().min(1).max(512) });
export const notification = z.object({ ...registration, update: z.object({ $type: z.enum([REPO_WRITE, REPO_REMOVED, REGISTRATION_EXPIRED, SPACE_DELETED]) }) });
export type Update = z.infer<typeof notification>["update"]["$type"];

export const authorization = z.object({ credential: z.string(), spaceRev: z.string().optional() });
export const refusal = z.object({ error: z.string().optional() });

export const writers = z.object({
  repos: z.array(
    z.discriminatedUnion("$type", [
      z.object({ $type: z.literal(REPO_WRITE), repo: did, repoRev: z.string(), spaceRev: z.string() }),
      z.object({ $type: z.literal(REPO_REMOVED), repo: did, spaceRev: z.string() }),
    ]),
  ),
  cursor: z.string().optional(),
});

export const repoOps = z.object({
  ops: z.array(
    z.object({
      rev: z.string(),
      collection: z.string(),
      rkey: z.string(),
      cid: z.string().nullable(),
      prev: z.string().nullable(),
      value: z.json().optional(),
    }),
  ),
  commit: z.object({ ver: z.number(), repo: did, space: spaceUri, rev: z.string(), data: z.object({ $bytes: z.string() }) }),
  cursor: z.string().optional(),
});

export const didDocument = z.object({
  service: z.array(z.object({ id: z.string(), serviceEndpoint: z.url() })).default([]),
  verificationMethod: z.array(z.object({ id: z.string(), publicKeyMultibase: z.string().optional() })).default([]),
});

// Jetstream's commit event with one added field, `space`. `time_us` is the feed's own monotonic
// sequence and the replay cursor, as it is for Jetstream.
export type StreamEvent =
  | {
      did: string;
      time_us: number;
      kind: "commit";
      space: string;
      commit: { rev: string; operation: "create" | "update" | "delete"; collection: string; rkey: string; cid?: string; record?: z.infer<ReturnType<typeof z.json>> };
    }
  | { did: string; time_us: number; kind: "writer"; space: string; writer: { status: "removed" } }
  | { did: string; time_us: number; kind: "space_deleted"; space: string };
