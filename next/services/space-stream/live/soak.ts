// Trials that take real time, against real hosts. Test accounts only; see harness.ts for the
// environment. Run one in the background and read its output afterwards:
//
//   bun run soak renew   one stream held open for SOAK_MINUTES (default 30), renewed by
//                        POST /renew every RENEW_MINUTES (default 4), a write every 90 s
//   bun run soak lapse   nobody connected for LAPSE_MINUTES (default 13) while records are
//                        written, then a reconnect from the cursor
//
// Both finish by deleting the space under an open stream.
import { type Account, COLLECTION, ORIGIN, type Seen, consumer, created, delegation, put, required, session } from "./harness";
import type { SpaceUri } from "../src/wire";

const MINUTE = 60_000;
const minutes = (name: string, fallback: number) => Number(process.env[name] ?? fallback) * MINUTE;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const started = Date.now();
const log = (line: string) => console.log(`${new Date().toISOString().slice(11, 19)} +${String(Math.round((Date.now() - started) / 1000)).padStart(4)}s ${line}`);

const owner = await session(required("LORE_OWNER_HANDLE"), required("LORE_OWNER_APP_PASSWORD"));
const member = await session(required("LORE_MEMBER_HANDLE"), required("LORE_MEMBER_APP_PASSWORD"));
const policy = { $type: "com.atproto.memberspace.policy", publishPolicy: true };

async function renew(who: Account, space: SpaceUri): Promise<string> {
  const response = await fetch(`${ORIGIN}/renew`, { method: "POST", body: JSON.stringify({ space, delegationToken: await delegation(who, space) }) });
  return `${response.status} ${await response.text()}`;
}

type Stream = Awaited<ReturnType<typeof consumer>>;
const summary = (messages: Seen[]) => messages.flatMap((message) => (message.commit ? [`${message.commit.operation}:${message.commit.rkey}`] : [`(${message.kind})`])).join(" ");

// A write and how long its event took. A webhook the host never delivered shows up as an event
// that only arrives with the next renewal's pull, or not at all.
async function timed(stream: Stream, who: Account, space: SpaceUri, rkey: string, waitMs: number): Promise<number | null> {
  const wrote = performance.now();
  await put(who, space, rkey, rkey);
  return stream.commit(rkey, "create", waitMs).then(
    (event) => Math.round(event.at - wrote),
    () => null,
  );
}

// Deleting the space under an open stream: the host's #spaceDeleted is a claim, and the next
// lent token is what confirms it with the authority.
async function deleteUnder(stream: Stream, space: SpaceUri) {
  await owner.procedure("com.atproto.space.deleteSpace", JSON.stringify({ space }));
  log("space deleted at the host");
  await sleep(5000);
  const token = await delegation(member, space).catch((error: Error) => `refused at the member's pds: ${error.message.slice(0, 120)}`);
  if (token.startsWith("refused")) log(token);
  else {
    const response = await fetch(`${ORIGIN}/renew`, { method: "POST", body: JSON.stringify({ space, delegationToken: token }) });
    log(`renewal after deletion: ${response.status} ${await response.text()}`);
  }
  await sleep(5000);
  log(`stream after deletion: last=${JSON.stringify(stream.messages.at(-1))} closes=${JSON.stringify(stream.closes)}`);
}

async function renewTrial(space: SpaceUri) {
  const total = minutes("SOAK_MINUTES", 30);
  const every = minutes("RENEW_MINUTES", 4);
  const stream = await consumer(space, await delegation(member, space));
  await sleep(1000);
  log(`connected: ${JSON.stringify(stream.messages[0])}`);
  const latencies: { rkey: string; ms: number | null }[] = [];
  let renewedAt = Date.now();
  for (let n = 0; Date.now() - started < total; n++) {
    await sleep(90_000);
    if (Date.now() - renewedAt >= every) {
      renewedAt = Date.now();
      log(`renew: ${await renew(member, space)}`);
      // far enough from the renewal's own pull that a prompt event can only be a webhook's
      await sleep(15_000);
    }
    const who = n % 2 ? member : owner;
    const rkey = `soak-${n}`;
    const ms = await timed(stream, who, space, rkey, 45_000);
    latencies.push({ rkey, ms });
    log(`${who === owner ? "owner " : "member"} ${rkey}: ${ms === null ? "NO EVENT within 45 s" : `${ms} ms`}; closes=${JSON.stringify(stream.closes)}`);
  }
  const arrived = latencies.flatMap((entry) => (entry.ms === null ? [] : [entry.ms])).sort((a, b) => a - b);
  const late = latencies.filter((entry) => entry.ms === null).map((entry) => entry.rkey);
  log(`writes=${latencies.length} prompt=${arrived.length} median=${arrived[Math.floor(arrived.length / 2)]} ms max=${arrived.at(-1)} ms late=${JSON.stringify(late)}`);
  log(`late ones present by the end: ${late.every((rkey) => stream.messages.some((message) => message.commit?.rkey === rkey))}`);
  log(`errors=${stream.messages.filter((message) => message.kind === "sync_error").length} closes=${JSON.stringify(stream.closes)}`);
  await deleteUnder(stream, space);
}

async function lapseTrial(space: SpaceUri) {
  const gap = minutes("LAPSE_MINUTES", 13);
  await put(owner, space, "before", "before");
  const first = await consumer(space, await delegation(member, space));
  const cursor = (await first.commit("before")).time_us;
  first.ws.close();
  log(`first consumer saw: ${summary(first.messages)}; closed, cursor=${cursor}`);

  // Thirds of the gap: the early writes land while the registration is live, the late ones
  // after it lapsed.
  const expected: string[] = [];
  const left = Date.now();
  for (let n = 0; n < 6; n++) {
    await sleep(gap / 7);
    const who = n % 2 ? member : owner;
    const rkey = `gap-${n}`;
    await put(who, space, rkey, rkey);
    expected.push(`create:${rkey}`);
    log(`${who === owner ? "owner " : "member"} wrote ${rkey} with nobody connected, ${Math.round((Date.now() - left) / 1000)} s after leaving`);
  }
  await member.procedure("com.atproto.space.deleteRecord", JSON.stringify({ space, repo: member.did, collection: COLLECTION, rkey: "gap-1" }));
  expected.push("delete:gap-1");
  await sleep(gap / 7);

  log(`reconnecting ${Math.round((Date.now() - left) / 1000)} s after leaving`);
  const back = await consumer(space, await delegation(member, space), `&cursor=${cursor}&wantedCollections=${COLLECTION}`);
  await sleep(5000);
  const got = back.messages.flatMap((message) => (message.commit ? [`${message.commit.operation}:${message.commit.rkey}`] : []));
  log(`replayed: ${summary(back.messages)}`);
  log(`missing=${JSON.stringify(expected.filter((entry) => !got.includes(entry)))} extra=${JSON.stringify(got.filter((entry) => !expected.includes(entry)))}`);
  const byWriter = (parity: number) => got.filter((entry) => entry.startsWith("create:") && Number(entry.slice("create:gap-".length)) % 2 === parity);
  log(`each writer's records in the order written: ${[0, 1].every((parity) => byWriter(parity).join() === byWriter(parity).toSorted().join())}`);
  log(`errors=${back.messages.filter((message) => message.kind === "sync_error").map((message) => message.message).join("; ") || "none"}`);
  for (const who of [owner, member]) {
    const ms = await timed(back, who, space, `after-${who === owner ? "owner" : "member"}`, 45_000);
    log(`live again, ${who === owner ? "owner" : "member"} write: ${ms === null ? "NO EVENT within 45 s" : `${ms} ms`}`);
  }
  await deleteUnder(back, space);
}

const mode = process.argv[2];
if (mode !== "renew" && mode !== "lapse") throw new Error("usage: bun run soak renew|lapse");
const { space } = created.parse(JSON.parse(await owner.procedure("com.atproto.space.createSpace", JSON.stringify({ spaceType: "tech.waow.doodl.space", policy }))));
log(`${mode} trial on ${ORIGIN}; owner on ${owner.pds}, member on ${member.pds}; ${space}`);
try {
  await owner.procedure("com.atproto.memberspace.putMembers", JSON.stringify({ space, members: [{ did: member.did, read: true, write: true }] }));
  await (mode === "renew" ? renewTrial(space) : lapseTrial(space));
} catch (error) {
  log(`FAILED: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  // Already gone when the trial reached its deletion step.
  await owner.procedure("com.atproto.space.deleteSpace", JSON.stringify({ space })).catch(() => undefined);
}
process.exit();
