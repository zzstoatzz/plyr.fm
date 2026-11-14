import { P256Keypair, Secp256k1Keypair } from "@atproto/crypto";
import {
  COMMIT_MAC_PROFILE,
  createCommitMacHeaders,
  createDelegationToken,
  createSpaceCredential,
  decapsulate,
  parseMacRequest,
  parseSpaceToken,
  verifyCredentialSig,
} from "@atproto/space";
import { z } from "zod";
import { REPO_REMOVED, REPO_WRITE, spaceUri } from "../src/wire";

// A space host and its writers' PDS, in memory, answering the way zds and the reference PDS do.
// It runs outside the worker; tests drive it through https://control.test.
export const AUTHORITY = "did:plc:authority000000000000000";
export const WRITER = "did:plc:writer00000000000000000";
export const MEMBER = "did:plc:member00000000000000000";
export const STRANGER = "did:plc:stranger0000000000000000";

const did = z.templateLiteral(["did:", z.string(), ":", z.string()]);
const op = z.object({ repo: did, rev: z.string(), collection: z.string(), rkey: z.string(), cid: z.string().nullable(), prev: z.string().nullable(), value: z.json().optional() });
const control = z.discriminatedUnion("action", [
  z.object({ action: z.literal("write"), space: spaceUri, op }),
  z.object({ action: z.literal("remove"), space: spaceUri, repo: did, spaceRev: z.string() }),
  z.object({ action: z.literal("expel"), space: spaceUri, did }),
  z.object({ action: z.literal("delegation"), space: spaceUri, did }),
  z.object({ action: z.literal("delete"), space: spaceUri }),
  z.object({ action: z.literal("registration"), space: spaceUri }),
]);
export type Control = z.infer<typeof control>;
const authorizeBody = z.object({
  space: spaceUri,
  credentialKey: did,
  delegationToken: z.string().optional(),
  notify: z.object({ endpoint: z.string(), token: z.string() }).optional(),
});

type Registration = z.infer<typeof authorizeBody>["notify"];
type Space = { ops: z.infer<typeof op>[]; removed: { repo: string; spaceRev: string }[]; expelled: Set<string>; registration: Registration; deleted: boolean };

const authorityKey = await Secp256k1Keypair.create();
const accountKey = await Secp256k1Keypair.create();
// every account's #atproto_kem key, which repo responses are MACed against.
const kemKey = await P256Keypair.create({ exportable: true });
const spaces = new Map<string, Space>();

function stateOf(space: string): Space {
  const existing = spaces.get(space);
  if (existing) return existing;
  const created: Space = { ops: [], removed: [], expelled: new Set(), registration: undefined, deleted: false };
  spaces.set(space, created);
  return created;
}

const refuse = (error: string, status: number) => Response.json({ error }, { status });

async function drive(request: Request): Promise<Response> {
  const command = control.parse(await request.json());
  const state = stateOf(command.space);
  if (command.action === "write") state.ops.push(command.op);
  if (command.action === "remove") state.removed.push({ repo: command.repo, spaceRev: command.spaceRev });
  if (command.action === "expel") state.expelled.add(command.did);
  if (command.action === "delete") state.deleted = true;
  if (command.action === "delegation") {
    return Response.json({ token: await createDelegationToken({ iss: command.did, sub: command.space, aud: AUTHORITY, keypair: accountKey }) });
  }
  return Response.json({ registration: state.registration ?? null });
}

async function authorizeSpaceSync(request: Request): Promise<Response> {
  const body = authorizeBody.parse(await request.json());
  const state = stateOf(body.space);
  // Answered before the caller's tokens are looked at, so a syncer with none can ask.
  if (state.deleted) return refuse("SpaceDeleted", 400);
  let member: string;
  try {
    member = parseSpaceToken("delegation", body.delegationToken ?? "").payload.iss;
  } catch {
    return refuse("InvalidDelegationToken", 400);
  }
  // zds answers a refused account as though the space did not exist, and withdraws the
  // registration the refused request carried.
  if (member === STRANGER || state.expelled.has(member)) {
    if (body.notify?.token === state.registration?.token) state.registration = undefined;
    return refuse("SpaceNotFound", 400);
  }
  state.registration = body.notify;
  return Response.json({ credential: await createSpaceCredential({ iss: AUTHORITY, sub: body.space, keyId: body.credentialKey, keypair: authorityKey }) });
}

export async function testHost(request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (url.hostname === "control.test") return drive(request);
  if (url.hostname === "plc.directory") {
    const account = url.pathname.slice(1);
    return Response.json({
      id: account,
      verificationMethod: [{ id: `${account}#atproto_kem`, publicKeyMultibase: kemKey.did().slice("did:key:".length) }],
      service: [{ id: "#atproto_pds", serviceEndpoint: account === AUTHORITY ? "https://authority.test" : "https://writer.test" }],
    });
  }
  if (url.pathname.endsWith("authorizeSpaceSync")) return authorizeSpaceSync(request);

  const headers = Object.fromEntries(request.headers);
  const authorization = headers.authorization ?? "";
  try {
    if (!authorization.startsWith("Atproto-Space-Credential ")) throw new Error("wrong scheme");
    const { payload } = parseSpaceToken("credential", authorization.slice("Atproto-Space-Credential ".length));
    await verifyCredentialSig(headers, did.parse(payload.cnf?.kid));
  } catch {
    return refuse("InvalidToken", 401);
  }
  const space = spaceUri.parse(url.searchParams.get("space"));
  const state = stateOf(space);

  if (url.pathname.endsWith("listWriters")) {
    if (headers["atproto-space-audience"] !== AUTHORITY) return refuse("InvalidToken", 401);
    const after = url.searchParams.get("cursor") ?? "";
    const latest = new Map<string, { $type: string; repo: string; spaceRev: string; repoRev?: string }>();
    for (const write of state.ops) latest.set(write.repo, { $type: REPO_WRITE, repo: write.repo, repoRev: write.rev, spaceRev: write.rev });
    for (const gone of state.removed) latest.set(gone.repo, { $type: REPO_REMOVED, ...gone });
    const repos = [...latest.values()].filter((entry) => entry.spaceRev > after).sort((a, b) => (a.spaceRev < b.spaceRev ? -1 : 1));
    return Response.json({ repos });
  }
  if (url.pathname.endsWith("listRepoOps")) {
    const repo = did.parse(url.searchParams.get("repo"));
    if (headers["atproto-space-audience"] !== repo) return refuse("InvalidToken", 401);
    const mac = parseMacRequest(headers["accept-signature"], COMMIT_MAC_PROFILE);
    if (!mac) return refuse("InvalidSpaceMac", 400);
    const since = url.searchParams.get("since") ?? "";
    const written = state.ops.filter((write) => write.repo === repo);
    const ops = written.filter((write) => write.rev > since).map(({ repo: _repo, ...rest }) => rest);
    const commit = { ver: 1, repo, space, rev: written.at(-1)?.rev ?? since, data: new Uint8Array(3) };
    const signed = createCommitMacHeaders(commit, { ...mac, sharedSecret: decapsulate(kemKey, mac.keyShare) });
    return Response.json({ ops, commit: { ...commit, data: { $bytes: "AAAA" } } }, { headers: signed.headers });
  }
  return new Response("unexpected test request", { status: 500 });
}
