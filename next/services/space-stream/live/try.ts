// A trial against real hosts: creates a temporary space, streams it through a deployed feed, and
// deletes it. Test accounts only; see harness.ts for the environment it reads.
import { COLLECTION, ORIGIN, consumer, created, delegation, put, refused, required, session } from "./harness";

const owner = await session(required("LORE_OWNER_HANDLE"), required("LORE_OWNER_APP_PASSWORD"));
const member = await session(required("LORE_MEMBER_HANDLE"), required("LORE_MEMBER_APP_PASSWORD"));
console.log(`feed ${ORIGIN}; owner on ${owner.pds}, member on ${member.pds}`);

const policy = { $type: "com.atproto.memberspace.policy", publishPolicy: true };
const { space } = created.parse(JSON.parse(await owner.procedure("com.atproto.space.createSpace", JSON.stringify({ spaceType: "tech.waow.doodl.space", policy }))));
try {
  await owner.procedure("com.atproto.memberspace.putMembers", JSON.stringify({ space, members: [{ did: member.did, read: true, write: true }] }));
  await put(owner, space, "before", "written before anyone connected");

  const stream = await consumer(space, await delegation(member, space));
  const backlog = await stream.commit("before");
  console.log(`backlog replayed: from owner=${backlog.did === owner.did}, record=${backlog.commit?.record?.title !== undefined}`);
  console.log(`collections seen: ${[...new Set(stream.messages.flatMap((message) => (message.commit ? [message.commit.collection] : [])))].join(", ")}`);

  let wrote = performance.now();
  await put(owner, space, "live-owner", "owner write on the space host");
  const liveOwner = await stream.commit("live-owner");
  console.log(`owner write to event: ${Math.round(liveOwner.at - wrote)} ms`);

  wrote = performance.now();
  await put(member, space, "live-member", "member write on another PDS");
  const liveMember = await stream.commit("live-member");
  console.log(`member write to event: ${Math.round(liveMember.at - wrote)} ms (from member=${liveMember.did === member.did})`);

  wrote = performance.now();
  await member.procedure("com.atproto.space.deleteRecord", JSON.stringify({ space, repo: member.did, collection: COLLECTION, rkey: "live-member" }));
  console.log(`delete to event: ${Math.round((await stream.commit("live-member", "delete")).at - wrote)} ms`);

  console.log(`forged token refused: ${await refused(space, "not-a-delegation")}`);

  const renewed = await fetch(`${ORIGIN}/renew`, { method: "POST", body: JSON.stringify({ space, delegationToken: await delegation(member, space) }) });
  console.log(`renewal: ${renewed.status} ${await renewed.text()}`);

  const resumed = await consumer(space, await delegation(owner, space), `&cursor=${liveOwner.time_us}&wantedCollections=${COLLECTION}`);
  await resumed.commit("live-member", "delete");
  console.log(`resumed after live-owner: ${resumed.messages.flatMap((message) => (message.commit ? [`${message.commit.operation}:${message.commit.rkey}`] : [])).join(", ")}`);
  resumed.ws.close();

  await owner.procedure("com.atproto.memberspace.removeMembers", JSON.stringify({ space, dids: [member.did] }));
  const stale = await delegation(member, space).catch((error: Error) => `refused at the member's pds: ${error.message.slice(0, 80)}`);
  console.log(`removed member refused: ${stale.startsWith("refused") ? stale : await refused(space, stale)}`);
  stream.ws.close();
} finally {
  await owner.procedure("com.atproto.space.deleteSpace", JSON.stringify({ space })).catch((error: Error) => console.error(`cleanup failed for ${space}: ${error.message}`));
}
process.exit(0);
