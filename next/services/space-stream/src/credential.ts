import { P256Keypair } from "@atproto/crypto";
import { createSpaceSigHeaders, parseSpaceToken } from "@atproto/space";
import { type Lent, type SpaceUri, authorityOf, authorization, didDocument, refusal } from "./wire";

export class AuthorizeError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(`authorizeSpaceSync ${status}: ${code}`);
  }

  // The authority said no, as opposed to failing to answer.
  get refused(): boolean {
    return this.status >= 400 && this.status < 500;
  }

  // The authority says the space was deleted. It answers this to anyone, token or not.
  get spaceDeleted(): boolean {
    return this.code === "SpaceDeleted";
  }
}

export class SpaceCredential {
  readonly expiresAt: number;

  constructor(
    readonly space: string,
    readonly token: string,
    readonly key: P256Keypair,
  ) {
    const { payload } = parseSpaceToken("credential", token);
    if (payload.sub !== space || payload.cnf?.kid !== key.did()) throw new Error("credential binding mismatch");
    this.expiresAt = payload.exp * 1000;
  }

  get live(): boolean {
    return Date.now() < this.expiresAt;
  }

  // The private key as hex, to keep beside the token for as long as the credential lives.
  async exportKey(): Promise<string> {
    return Array.from(await this.key.export(), (byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  static async restore(space: string, token: string, key: string): Promise<SpaceCredential> {
    return new SpaceCredential(space, token, await P256Keypair.import(key, { exportable: true }));
  }

  async fetch(url: string, audience: `did:${string}:${string}`, acceptSignature?: string): Promise<Response> {
    const { headers } = await createSpaceSigHeaders({ authorization: `Atproto-Space-Credential ${this.token}`, audience, keypair: this.key });
    const response = await fetch(url, { headers: acceptSignature ? { ...headers, "accept-signature": acceptSignature } : headers, redirect: "manual" });
    if (response.status >= 300 && response.status < 400) throw new Error("unexpected redirect from a space host");
    return response;
  }
}

// The account whose PDS minted a delegation. The authority verifies the token; this only reads
// who it claims to be from, to tie a consumer's sockets to the renewals that keep them open.
export function delegator(delegationToken: string): string {
  return parseSpaceToken("delegation", delegationToken).payload.iss;
}

// The authority decides. A credential coming back proves that whoever lent the tokens may read
// the space, and each call renews the update registration for `endpoint` and `notifyToken`.
export async function authorize(space: SpaceUri, lent: Lent, endpoint: string, notifyToken: string): Promise<SpaceCredential> {
  const key = await P256Keypair.create({ exportable: true });
  const response = await ask(space, { credentialKey: key.did(), ...lent, notify: { endpoint, token: notifyToken } });
  return new SpaceCredential(space, authorization.parse(await response.json()).credential, key);
}

// Whether the authority itself says the space is gone. Hosts answer this before they look at
// who is asking, so it needs no lent token.
export async function deleted(space: SpaceUri): Promise<boolean> {
  const key = await P256Keypair.create();
  try {
    await ask(space, { credentialKey: key.did() });
    return false;
  } catch (error) {
    return error instanceof AuthorizeError && error.spaceDeleted;
  }
}

type Asked = Partial<Lent> & { credentialKey: string; notify?: { endpoint: string; token: string } };

async function ask(space: SpaceUri, body: Asked): Promise<Response> {
  const { pds } = await resolveIdentity(authorityOf(space));
  const response = await fetch(`${pds}/xrpc/com.atproto.space.authorizeSpaceSync`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    redirect: "manual",
    body: JSON.stringify({ space, ...body }),
  });
  if (response.ok) return response;
  const refused = refusal.safeParse(await response.json().catch(() => null));
  throw new AuthorizeError(response.status, refused.data?.error ?? "NotAuthorized");
}

type Identity = { pds: string; kemKey: `did:key:${string}` | undefined };
const identities = new Map<string, Identity>();

// An account's PDS and the `#atproto_kem` key its repo responses are MACed against.
export async function resolveIdentity(did: string): Promise<Identity> {
  const cached = identities.get(did);
  if (cached) return cached;
  const url = did.startsWith("did:web:") ? `https://${decodeURIComponent(did.slice("did:web:".length))}/.well-known/did.json` : `https://plc.directory/${did}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`could not resolve ${did}: ${response.status}`);
  const document = didDocument.parse(await response.json());
  const pds = document.service.find((service) => service.id.endsWith("#atproto_pds"))?.serviceEndpoint;
  if (!pds) throw new Error(`${did} has no #atproto_pds service`);
  const kem = document.verificationMethod.find((method) => method.id.endsWith("#atproto_kem"))?.publicKeyMultibase;
  const identity: Identity = { pds: pds.replace(/\/$/, ""), kemKey: kem ? `did:key:${kem}` : undefined };
  identities.set(did, identity);
  return identity;
}
