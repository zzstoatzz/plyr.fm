import { SELF, env, evictDurableObject, runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { expect, it } from "vitest";
import { z } from "zod";
import type { SpaceUri } from "../src/wire";
import { AUTHORITY, type Control, MEMBER, STRANGER, WRITER } from "./host";

const ORIGIN = "https://space-stream.test";
const COLLECTION = "tech.waow.ops.finding";
const space = (id: string): SpaceUri => `at://${AUTHORITY}/space/tech.waow.ops.space/${id}`;
const stub = (uri: SpaceUri) => env.FEED.get(env.FEED.idFromName(uri));

const controlReply = z.object({
  token: z.string().optional(),
  registration: z.object({ endpoint: z.string(), token: z.string() }).nullable().optional(),
});
const message = z.object({
  kind: z.string(),
  did: z.string().optional(),
  time_us: z.number().optional(),
  space: z.string().optional(),
  expires_at: z.string().optional(),
  commit: z.object({ operation: z.string(), collection: z.string(), rkey: z.string(), rev: z.string(), record: z.json().optional() }).optional(),
});
type Message = z.infer<typeof message>;

async function control(command: Control) {
  const response = await fetch("https://control.test", { method: "POST", body: JSON.stringify(command) });
  return controlReply.parse(await response.json());
}

const write = (uri: SpaceUri, rev: string, rkey: string, collection = COLLECTION) =>
  control({ action: "write", space: uri, op: { repo: WRITER, rev, collection, rkey, cid: `cid-${rev}`, prev: null, value: { title: rkey } } });

async function delegation(uri: SpaceUri, did: typeof MEMBER | typeof STRANGER = MEMBER): Promise<string> {
  const { token } = await control({ action: "delegation", space: uri, did });
  if (!token) throw new Error("no delegation");
  return token;
}

async function registrationToken(uri: SpaceUri): Promise<string> {
  const { registration } = await control({ action: "registration", space: uri });
  if (!registration) throw new Error("the feed never registered");
  expect(registration.endpoint).toBe(ORIGIN);
  return registration.token;
}

function subscribe(uri: SpaceUri, token: string, query = "") {
  return SELF.fetch(`${ORIGIN}/subscribe?space=${encodeURIComponent(uri)}&delegation=${encodeURIComponent(token)}${query}`, { headers: { upgrade: "websocket" } });
}

async function connect(uri: SpaceUri, query = "") {
  const response = await subscribe(uri, await delegation(uri), query);
  const ws = response.webSocket;
  if (!ws) throw new Error(`no socket: ${response.status}`);
  ws.accept();
  const messages: Message[] = [];
  const closes: number[] = [];
  ws.addEventListener("message", (event) => messages.push(message.parse(JSON.parse(String(event.data)))));
  ws.addEventListener("close", (event) => closes.push(event.code));
  const until = async (done: () => boolean) => {
    const deadline = Date.now() + 5000;
    while (!done()) {
      if (Date.now() > deadline) throw new Error(`timed out; saw ${JSON.stringify(messages)} closes=${JSON.stringify(closes)}`);
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  };
  const commits = () => messages.filter((seen) => seen.kind === "commit");
  return {
    ws,
    messages,
    commits,
    rkeys: () => commits().map((seen) => seen.commit?.rkey),
    count: (n: number) => until(() => messages.length >= n),
    closed: async () => {
      await until(() => closes.length > 0);
      return closes[0];
    },
  };
}

async function notify(uri: SpaceUri, token: string, rev: string, type = "com.atproto.space.defs#repoWrite") {
  const update = { $type: type, repo: WRITER, repoRev: rev, data: { $bytes: "AAAA" }, spaceRev: rev };
  const response = await SELF.fetch(`${ORIGIN}/xrpc/com.atproto.space.notifySpaceUpdate`, { method: "POST", body: JSON.stringify({ space: uri, token, update }) });
  return response.status;
}

async function deliver(uri: SpaceUri, rev: string) {
  expect(await notify(uri, await registrationToken(uri), rev)).toBe(200);
  await runDurableObjectAlarm(stub(uri));
}

it("replays the backlog to a consumer the authority accepts, then streams a notified write", async () => {
  const uri = space("live");
  await write(uri, "3aaaaaaaaaa22", "first");
  const consumer = await connect(uri);
  await consumer.count(2);
  expect(consumer.messages[0]?.kind).toBe("authorized");
  expect(consumer.messages[1]).toMatchObject({ did: WRITER, kind: "commit", space: uri, commit: { operation: "create", collection: COLLECTION, rkey: "first", record: { title: "first" } } });

  await write(uri, "3aaaaaaaaaa23", "second");
  await deliver(uri, "3aaaaaaaaaa23");
  await consumer.count(3);
  expect(consumer.rkeys()).toEqual(["first", "second"]);
  expect(consumer.messages[2]?.time_us).toBeGreaterThan(consumer.messages[1]?.time_us ?? Infinity);
  consumer.ws.close();
});

it("refuses to open a stream for tokens the authority rejects", async () => {
  const uri = space("refused");
  await write(uri, "3aaaaaaaaaa22", "secret");
  const stranger = await subscribe(uri, await delegation(uri, STRANGER));
  expect([stranger.status, await stranger.json()]).toEqual([403, { error: "SpaceNotFound" }]);
  const forged = await subscribe(uri, "not-a-delegation");
  expect([forged.status, await forged.json()]).toEqual([403, { error: "InvalidDelegationToken" }]);
  expect((await SELF.fetch(`${ORIGIN}/subscribe?space=${encodeURIComponent(uri)}`, { headers: { upgrade: "websocket" } })).status).toBe(400);
});

it("serves only the space types it is deployed for", async () => {
  const other: SpaceUri = `at://${AUTHORITY}/space/com.example.other/x`;
  const refused = await subscribe(other, "any-token");
  expect([refused.status, await refused.json()]).toEqual([403, { error: "SpaceTypeNotServed" }]);
  const renewal = await SELF.fetch(`${ORIGIN}/renew`, { method: "POST", body: JSON.stringify({ space: other, delegationToken: "any-token" }) });
  expect([renewal.status, await renewal.json()]).toEqual([403, { error: "SpaceTypeNotServed" }]);
});

it("resumes from a cursor and filters by collection", async () => {
  const uri = space("cursor");
  await write(uri, "3aaaaaaaaaa22", "one");
  await write(uri, "3aaaaaaaaaa23", "other", "tech.waow.other.thing");
  await write(uri, "3aaaaaaaaaa24", "two");
  const first = await connect(uri);
  await first.count(4);
  first.ws.close();

  const filtered = await connect(uri, `&wantedCollections=${COLLECTION}`);
  await filtered.count(3);
  expect(filtered.rkeys()).toEqual(["one", "two"]);
  filtered.ws.close();

  const resumed = await connect(uri, `&cursor=${first.commits()[0]?.time_us}`);
  await resumed.count(3);
  expect(resumed.rkeys()).toEqual(["other", "two"]);
  resumed.ws.close();
});

it("reports deletes and a writer leaving the space", async () => {
  const uri = space("removal");
  await write(uri, "3aaaaaaaaaa22", "gone");
  await control({ action: "write", space: uri, op: { repo: WRITER, rev: "3aaaaaaaaaa23", collection: COLLECTION, rkey: "gone", cid: null, prev: "cid-3aaaaaaaaaa22" } });
  const consumer = await connect(uri);
  await consumer.count(3);
  expect(consumer.messages[2]?.commit).toEqual({ rev: "3aaaaaaaaaa23", operation: "delete", collection: COLLECTION, rkey: "gone" });

  await control({ action: "remove", space: uri, repo: WRITER, spaceRev: "3aaaaaaaaaa24" });
  await deliver(uri, "3aaaaaaaaaa24");
  await consumer.count(4);
  expect(consumer.messages[3]).toMatchObject({ did: WRITER, kind: "writer" });
  consumer.ws.close();
});

async function lapse(uri: SpaceUri) {
  await runInDurableObject(stub(uri), (_feed, state) => {
    for (const ws of state.getWebSockets()) ws.serializeAttachment({ ...ws.deserializeAttachment(), until: Date.now() - 1 });
  });
}
const expire = (uri: SpaceUri) => runInDurableObject(stub(uri), (feed) => feed.alarm());
const renew = (uri: SpaceUri, delegationToken: string) => SELF.fetch(`${ORIGIN}/renew`, { method: "POST", body: JSON.stringify({ space: uri, delegationToken }) });

it("closes a consumer whose authorization lapsed, and keeps one that renewed", async () => {
  const lapsing = space("lapse");
  const idle = await connect(lapsing);
  await idle.count(1);
  await lapse(lapsing);
  await expire(lapsing);
  expect(await idle.closed()).toBe(4401);

  const renewing = space("renew");
  const kept = await connect(renewing);
  await kept.count(1);
  await lapse(renewing);
  expect((await renew(renewing, await delegation(renewing))).status).toBe(200);
  await expire(renewing);
  await write(renewing, "3aaaaaaaaaa22", "after-renewal");
  await deliver(renewing, "3aaaaaaaaaa22");
  await kept.count(2);
  expect(kept.rkeys()).toEqual(["after-renewal"]);
  kept.ws.close();
});

it("does not let another account's renewal keep an expelled member's stream open", async () => {
  const uri = space("expelled");
  const member = await connect(uri);
  await member.count(1);
  await control({ action: "expel", space: uri, did: MEMBER });
  expect((await renew(uri, await delegation(uri))).status).toBe(403);
  await lapse(uri);
  const other = await control({ action: "delegation", space: uri, did: WRITER });
  expect((await renew(uri, other.token ?? "")).status).toBe(200);
  await expire(uri);
  expect(await member.closed()).toBe(4401);
});

it("refuses an update or confirmation carrying a token it did not issue", async () => {
  const uri = space("forged");
  const consumer = await connect(uri);
  await consumer.count(1);
  expect(await notify(uri, "forged", "3aaaaaaaaaa22")).toBe(401);
  const confirm = (token: string) =>
    SELF.fetch(`${ORIGIN}/xrpc/com.atproto.space.confirmRegistration`, { method: "POST", body: JSON.stringify({ space: uri, token, challenge: "c4" }) });
  expect((await confirm("forged")).status).toBe(401);
  expect(await (await confirm(await registrationToken(uri))).json()).toEqual({ challenge: "c4" });
  consumer.ws.close();
});

const stored = (uri: SpaceUri, table: "events" | "state") =>
  runInDurableObject(stub(uri), (_feed, state) => state.storage.sql.exec<{ n: number }>(`SELECT count(*) AS n FROM ${table}`).one().n);

it("pulls a notified write after it was evicted from memory", async () => {
  const uri = space("evicted");
  const consumer = await connect(uri);
  await consumer.count(1);
  consumer.ws.close();
  await evictDurableObject(stub(uri));
  await write(uri, "3aaaaaaaaaa22", "while-asleep");
  await deliver(uri, "3aaaaaaaaaa22");
  await expect.poll(() => stored(uri, "events")).toBe(1);
});

it("pulls on a renewal what no notification announced", async () => {
  const uri = space("unannounced");
  const consumer = await connect(uri);
  await consumer.count(1);
  await write(uri, "3aaaaaaaaaa22", "unannounced");
  expect((await renew(uri, await delegation(uri))).status).toBe(200);
  await consumer.count(2);
  expect(consumer.rkeys()).toEqual(["unannounced"]);
  consumer.ws.close();
});

it("catches up when a consumer returns after the registration expired", async () => {
  const uri = space("expired");
  await write(uri, "3aaaaaaaaaa22", "seen");
  const first = await connect(uri);
  await first.count(2);
  first.ws.close();
  const token = await registrationToken(uri);
  await runInDurableObject(stub(uri), (_feed, state) => state.storage.sql.exec("DELETE FROM state WHERE key IN ('credential', 'credentialKey')"));
  await evictDurableObject(stub(uri));

  await write(uri, "3aaaaaaaaaa23", "missed");
  expect(await notify(uri, token, "3aaaaaaaaaa23", "com.atproto.space.notifySpaceUpdate#registrationExpired")).toBe(200);
  await runDurableObjectAlarm(stub(uri));
  expect(await stored(uri, "events")).toBe(1);

  const back = await connect(uri, `&cursor=${first.commits()[0]?.time_us}`);
  await back.count(2);
  expect(back.rkeys()).toEqual(["missed"]);
  back.ws.close();
});

it("drops a space once the authority confirms it was deleted", async () => {
  const claimed = space("claimed");
  await write(claimed, "3aaaaaaaaaa22", "kept");
  const unaffected = await connect(claimed);
  await unaffected.count(2);
  expect(await notify(claimed, await registrationToken(claimed), "", "com.atproto.space.notifySpaceUpdate#spaceDeleted")).toBe(200);
  expect(await stored(claimed, "events")).toBe(1);
  unaffected.ws.close();

  const uri = space("deleted");
  await write(uri, "3aaaaaaaaaa22", "doomed");
  const consumer = await connect(uri);
  await consumer.count(2);
  const token = await registrationToken(uri);
  await control({ action: "delete", space: uri });
  expect(await notify(uri, token, "", "com.atproto.space.notifySpaceUpdate#spaceDeleted")).toBe(200);
  expect(await consumer.closed()).toBe(4404);
  expect(consumer.messages.at(-1)).toMatchObject({ did: AUTHORITY, kind: "space_deleted", space: uri });
  expect([await stored(uri, "events"), await stored(uri, "state")]).toEqual([0, 0]);
  expect(await notify(uri, token, "3aaaaaaaaaa23")).toBe(401);
  const late = await subscribe(uri, await delegation(uri));
  expect([late.status, await late.json()]).toEqual([403, { error: "SpaceDeleted" }]);
});

it("refuses an update of a kind the protocol does not define", async () => {
  const uri = space("unknown-update");
  const consumer = await connect(uri);
  await consumer.count(1);
  const response = await SELF.fetch(`${ORIGIN}/xrpc/com.atproto.space.notifySpaceUpdate`, {
    method: "POST",
    body: JSON.stringify({ space: uri, token: await registrationToken(uri), update: { $type: "com.atproto.space.defs#somethingElse" } }),
  });
  expect(response.status).toBe(400);
  consumer.ws.close();
});
