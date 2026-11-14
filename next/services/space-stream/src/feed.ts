import { COMMIT_MAC_PROFILE, encapsulate, formatMacRequest, verifyCommitMac } from "@atproto/space";
import { DurableObject } from "cloudflare:workers";
import { AuthorizeError, SpaceCredential, authorize, delegator, deleted, resolveIdentity } from "./credential";
import { type Did, type Lent, REPO_WRITE, SPACE_DELETED, type SpaceUri, type StreamEvent, type Update, authorityOf, readSubscription, repoOps, spaceUri, writers } from "./wire";

export type Env = { FEED: DurableObjectNamespace<SpaceFeed>; SPACE_TYPES?: string };

// What the feed remembers about a consumer's socket: who admitted it, what it wants, and when
// that admission runs out.
type Seat = { did: string; collections: string[]; until: number };

const EXPIRED = 4401;
const DELETED = 4404;
const encoder = new TextEncoder();
const refuse = (error: AuthorizeError) => Response.json({ error: error.code }, { status: error.refused ? 403 : 502 });

// One feed per space: the update registration, the sync checkpoint, the event log and the
// consumers' sockets. It holds no user session. It can read the space only while some consumer
// has lent it a delegation the authority accepted, and it serves only consumers who did.
export class SpaceFeed extends DurableObject<Env> {
  private held: SpaceCredential | null = null;
  private pulling: Promise<void> | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS events (time_us INTEGER PRIMARY KEY, collection TEXT, json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS repos (did TEXT PRIMARY KEY, rev TEXT, removed INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    `);
  }

  private get(key: string): string | undefined {
    return this.ctx.storage.sql.exec<{ value: string }>("SELECT value FROM state WHERE key = ?", key).toArray()[0]?.value;
  }

  private put(key: string, value: string) {
    this.ctx.storage.sql.exec("INSERT INTO state (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value", key, value);
  }

  // One opaque token per space, stable across authorizations so each one renews the same
  // registration.
  private notifyToken(): string {
    const issued = this.get("notifyToken");
    if (issued) return issued;
    const token = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
    this.put("notifyToken", token);
    return token;
  }

  // Space hosts call the update methods with no auth; this token in the body is the proof.
  async issued(space: string, token: string): Promise<boolean> {
    const issued = this.get("notifyToken");
    if (!issued || this.get("space") !== space) return false;
    const [a, b] = [encoder.encode(token), encoder.encode(issued)];
    return a.byteLength === b.byteLength && crypto.subtle.timingSafeEqual(a, b);
  }

  // Every update leaves the feed behind the space, so each one queues a pull. What differs is
  // what the pull can do about it:
  // - a write or removal is pulled at once with the credential the last consumer's token bought;
  // - an expired registration means that credential has run out too, and the feed has no token
  //   of its own to renew with, so the pull waits for the next consumer to lend one;
  // - a deletion is a claim until the authority confirms it, which it does to anyone who asks.
  async notify(space: SpaceUri, token: string, update: Update): Promise<boolean> {
    if (!(await this.issued(space, token))) return false;
    console.log("update", update);
    if (update === SPACE_DELETED) {
      if (await deleted(space)) this.drop(space);
      return true;
    }
    this.put("pending", "1");
    await this.ctx.storage.setAlarm(Date.now());
    return true;
  }

  // The authority's answer to the lent tokens is the admission check. The same exchange renews
  // the feed's credential and registration, so consumers that keep lending keep it syncing.
  private async admit(space: SpaceUri, endpoint: string, lent: Lent): Promise<SpaceCredential> {
    this.put("space", space);
    let credential: SpaceCredential;
    try {
      credential = await authorize(space, lent, endpoint, this.notifyToken());
    } catch (error) {
      if (error instanceof AuthorizeError && error.spaceDeleted) this.drop(space);
      throw error;
    }
    // Kept in storage as well as memory: a feed with idle consumers is evicted between updates,
    // and the update that wakes it has to find a credential to pull with.
    this.put("credential", credential.token);
    this.put("credentialKey", await credential.exportKey());
    this.held = credential;
    return credential;
  }

  private async credential(space: string): Promise<SpaceCredential | null> {
    if (this.held) return this.held;
    const [token, key] = [this.get("credential"), this.get("credentialKey")];
    if (token && key) this.held = await SpaceCredential.restore(space, token, key);
    return this.held;
  }

  // A deleted space takes everything the feed kept about it. Consumers get one last event.
  private drop(space: SpaceUri) {
    this.append({ did: authorityOf(space), time_us: 0, kind: "space_deleted", space });
    for (const ws of this.ctx.getWebSockets()) ws.close(DELETED, "space deleted");
    this.ctx.storage.sql.exec("DELETE FROM events; DELETE FROM repos; DELETE FROM state;");
    this.held = null;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const wanted = readSubscription(url);
    if (!wanted.success) return Response.json({ error: "InvalidRequest" }, { status: 400 });
    const { space, cursor, collections, ...lent } = wanted.data;
    const endpoint = url.origin;
    let credential: SpaceCredential;
    try {
      credential = await this.admit(space, endpoint, lent);
    } catch (error) {
      if (error instanceof AuthorizeError) return refuse(error);
      throw error;
    }
    const failure = await this.pull().then(
      () => null,
      (error: Error) => error.message,
    );
    const pair = new WebSocketPair();
    const seat: Seat = { did: delegator(lent.delegationToken), collections, until: credential.expiresAt };
    this.ctx.acceptWebSocket(pair[1]);
    pair[1].serializeAttachment(seat);
    pair[1].send(JSON.stringify({ kind: "authorized", expires_at: new Date(seat.until).toISOString() }));
    if (failure) pair[1].send(JSON.stringify({ kind: "sync_error", message: failure }));
    const rows = this.ctx.storage.sql.exec<{ collection: string | null; json: string }>("SELECT collection, json FROM events WHERE time_us > ? ORDER BY time_us", cursor);
    for (const row of rows) if (wants(collections, row.collection)) pair[1].send(row.json);
    await this.scheduleExpiry();
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  // A renewal extends only the sockets admitted for the same account.
  async renew(space: SpaceUri, endpoint: string, lent: Lent): Promise<Response> {
    let credential: SpaceCredential;
    try {
      credential = await this.admit(space, endpoint, lent);
    } catch (error) {
      if (error instanceof AuthorizeError) return refuse(error);
      throw error;
    }
    // Updates from the host are best effort, and the registration that carries them can be
    // withdrawn by another caller's refused token. A pull on every renewal bounds what an open
    // stream can miss to one renewal interval.
    await this.pull().catch((error: Error) => console.warn("sync failed", error.message));
    const did = delegator(lent.delegationToken);
    for (const ws of this.ctx.getWebSockets()) {
      const seat = seatOf(ws);
      if (seat.did === did) ws.serializeAttachment({ ...seat, until: credential.expiresAt } satisfies Seat);
    }
    await this.scheduleExpiry();
    return Response.json({ expires_at: new Date(credential.expiresAt).toISOString() });
  }

  async alarm() {
    if (this.get("pending")) await this.pull().catch((error: Error) => console.warn("sync failed", error.message));
    const now = Date.now();
    for (const ws of this.ctx.getWebSockets()) if (seatOf(ws).until <= now) ws.close(EXPIRED, "authorization expired");
    await this.scheduleExpiry();
  }

  private async scheduleExpiry() {
    const now = Date.now();
    const next = this.ctx
      .getWebSockets()
      .map((ws) => seatOf(ws).until)
      .filter((until) => until > now)
      .sort((a, b) => a - b)[0];
    if (next) await this.ctx.storage.setAlarm(next);
  }

  private pull(): Promise<void> {
    this.pulling ??= this.sync().finally(() => {
      this.pulling = null;
    });
    return this.pulling;
  }

  // Incremental sync from the checkpoint: the writers updated since, then each one's operations
  // since the revision already applied.
  private async sync() {
    const stored = this.get("space");
    if (!stored) return;
    const space = spaceUri.parse(stored);
    const credential = await this.credential(space);
    if (!credential?.live) return;
    const authority = authorityOf(space);
    const { pds } = await resolveIdentity(authority);
    let cursor = this.get("checkpoint");
    for (;;) {
      const query = new URLSearchParams({ space, limit: "1000" });
      if (cursor) query.set("cursor", cursor);
      const response = await credential.fetch(`${pds}/xrpc/com.atproto.space.listWriters?${query}`, authority);
      if (!response.ok) throw new Error(`listWriters ${response.status}: ${(await response.text()).slice(0, 300)}`);
      const page = writers.parse(await response.json());
      for (const entry of page.repos) {
        if (entry.$type === REPO_WRITE) await this.syncRepo(space, credential, entry.repo, entry.repoRev);
        else this.removeWriter(space, entry.repo);
        this.put("checkpoint", entry.spaceRev);
      }
      if (!page.cursor || !page.repos.length) break;
      cursor = page.cursor;
    }
    this.ctx.storage.sql.exec("DELETE FROM state WHERE key = 'pending'");
  }

  private async syncRepo(space: SpaceUri, credential: SpaceCredential, repo: Did, repoRev: string) {
    const applied = this.ctx.storage.sql.exec<{ rev: string | null }>("SELECT rev FROM repos WHERE did = ?", repo).toArray()[0]?.rev ?? undefined;
    if (applied && applied >= repoRev) return;
    const { pds, kemKey } = await resolveIdentity(repo);
    if (!kemKey) throw new Error(`${repo} has no #atproto_kem key`);
    let cursor: string | undefined;
    let head = applied ?? repoRev;
    for (;;) {
      const query = new URLSearchParams({ space, repo, limit: "1000" });
      if (applied) query.set("since", applied);
      if (cursor) query.set("cursor", cursor);
      // The repo host proves each page with a MAC keyed by a secret only it and this request share.
      const encapsulation = await encapsulate(kemKey);
      const response = await credential.fetch(`${pds}/xrpc/com.atproto.space.listRepoOps?${query}`, repo, formatMacRequest(COMMIT_MAC_PROFILE, encapsulation.keyShare));
      if (!response.ok) throw new Error(`listRepoOps ${pds} ${response.status}: ${(await response.text()).slice(0, 300)}`);
      const page = repoOps.parse(await response.json());
      if (page.commit.repo !== repo || page.commit.space !== space) throw new Error("commit is for another repo or space");
      const data = Uint8Array.from(atob(page.commit.data.$bytes), (char) => char.charCodeAt(0));
      verifyCommitMac({ ver: page.commit.ver, repo, space, rev: page.commit.rev, data }, { ...encapsulation, headers: response.headers });
      for (const op of page.ops) {
        const operation = op.cid === null ? "delete" : op.prev === null ? "create" : "update";
        const commit = { rev: op.rev, operation, collection: op.collection, rkey: op.rkey } as const;
        if (op.cid === null) this.append({ did: repo, time_us: 0, kind: "commit", space, commit });
        else if (op.value === undefined) this.append({ did: repo, time_us: 0, kind: "commit", space, commit: { ...commit, cid: op.cid } });
        else this.append({ did: repo, time_us: 0, kind: "commit", space, commit: { ...commit, cid: op.cid, record: op.value } });
      }
      head = page.commit.rev;
      if (!page.cursor || !page.ops.length) break;
      cursor = page.cursor;
    }
    this.ctx.storage.sql.exec("INSERT INTO repos (did, rev, removed) VALUES (?, ?, 0) ON CONFLICT (did) DO UPDATE SET rev = excluded.rev, removed = 0", repo, head);
  }

  private removeWriter(space: string, repo: string) {
    const row = this.ctx.storage.sql.exec<{ removed: number }>("SELECT removed FROM repos WHERE did = ?", repo).toArray()[0];
    if (row?.removed) return;
    this.ctx.storage.sql.exec("INSERT INTO repos (did, removed) VALUES (?, 1) ON CONFLICT (did) DO UPDATE SET removed = 1", repo);
    this.append({ did: repo, time_us: 0, kind: "writer", space, writer: { status: "removed" } });
  }

  private append(event: StreamEvent) {
    const stamped = { ...event, time_us: Math.max(Date.now() * 1000, Number(this.get("lastTime") ?? 0) + 1) };
    this.put("lastTime", String(stamped.time_us));
    const collection = stamped.kind === "commit" ? stamped.commit.collection : null;
    const json = JSON.stringify(stamped);
    this.ctx.storage.sql.exec("INSERT INTO events (time_us, collection, json) VALUES (?, ?, ?)", stamped.time_us, collection, json);
    const now = Date.now();
    for (const ws of this.ctx.getWebSockets()) {
      const seat = seatOf(ws);
      if (seat.until > now && wants(seat.collections, collection)) ws.send(json);
    }
  }
}

function seatOf(ws: WebSocket): Seat {
  // SAFETY: every socket this feed accepts gets a Seat attached in `fetch` before it is
  // returned, and `renew` only ever writes a Seat back.
  return ws.deserializeAttachment() as Seat;
}

// Jetstream's filter: exact NSIDs or a `prefix.*`. Events that are not about a record always pass.
function wants(collections: string[], collection: string | null): boolean {
  if (!collections.length || collection === null) return true;
  return collections.some((want) => (want.endsWith(".*") ? collection.startsWith(want.slice(0, -1)) : want === collection));
}
