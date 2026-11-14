// What the live trials share: sessions for the lore test accounts, a temporary space, and a
// consumer of a deployed feed. Reads LORE_OWNER_HANDLE, LORE_OWNER_APP_PASSWORD,
// LORE_MEMBER_HANDLE and LORE_MEMBER_APP_PASSWORD from the environment, and STREAM_ORIGIN for
// the feed to try.
import { z } from "zod";
import { type SpaceUri, spaceUri } from "../src/wire";

export const ORIGIN = process.env.STREAM_ORIGIN ?? "https://space-stream.n8-3e9.workers.dev";
export const COLLECTION = "tech.waow.ops.finding";

const identity = z.object({ pds: z.url() });
const login = z.object({ did: z.string(), accessJwt: z.string() });
export const created = z.object({ space: spaceUri });
const delegated = z.object({ token: z.string() });
const seen = z.object({
  kind: z.string(),
  did: z.string().optional(),
  time_us: z.number().optional(),
  message: z.string().optional(),
  expires_at: z.string().optional(),
  commit: z.object({ operation: z.string(), rkey: z.string(), collection: z.string(), record: z.object({ title: z.string().optional() }).optional() }).optional(),
});
export type Seen = z.infer<typeof seen> & { at: number };

export function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`missing ${name}`);
  return value;
}

export async function session(handle: string, password: string) {
  const resolved = await fetch(`https://slingshot.microcosm.blue/xrpc/blue.microcosm.identity.resolveMiniDoc?${new URLSearchParams({ identifier: handle })}`);
  const { pds } = identity.parse(await resolved.json());
  const response = await fetch(`${pds}/xrpc/com.atproto.server.createSession`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ identifier: handle, password }),
  });
  if (!response.ok) throw new Error(`login ${handle}: ${response.status}`);
  const { did, accessJwt } = login.parse(await response.json());
  const answer = async (method: string, response: Response) => {
    const text = await response.text();
    if (!response.ok) throw new Error(`${method}: ${response.status} ${text.slice(0, 300)}`);
    return text;
  };
  return {
    did,
    pds,
    query: async (method: string, params: URLSearchParams) =>
      answer(method, await fetch(`${pds}/xrpc/${method}?${params}`, { headers: { authorization: `Bearer ${accessJwt}` } })),
    procedure: async (method: string, body: string) =>
      answer(method, await fetch(`${pds}/xrpc/${method}`, { method: "POST", body, headers: { authorization: `Bearer ${accessJwt}`, "content-type": "application/json" } })),
  };
}
export type Account = Awaited<ReturnType<typeof session>>;

export async function delegation(who: Account, space: SpaceUri): Promise<string> {
  return delegated.parse(JSON.parse(await who.query("com.atproto.space.getDelegationToken", new URLSearchParams({ space })))).token;
}

export const put = (who: Account, space: SpaceUri, rkey: string, title: string) =>
  who.procedure("com.atproto.space.putRecord", JSON.stringify({ space, repo: who.did, collection: COLLECTION, rkey, record: { $type: COLLECTION, title, createdAt: new Date().toISOString() } }));

const subscribeUrl = (space: SpaceUri, token: string, query = "") =>
  `${ORIGIN}/subscribe?space=${encodeURIComponent(space)}&delegation=${encodeURIComponent(token)}${query}`;

// A refused subscription fails the upgrade, and a websocket client sees only that it failed.
export async function refused(space: SpaceUri, token: string): Promise<boolean> {
  return consumer(space, token).then(
    (opened) => {
      opened.ws.close();
      return false;
    },
    () => true,
  );
}

export async function consumer(space: SpaceUri, token: string, query = "") {
  const ws = new WebSocket(subscribeUrl(space, token, query).replace(/^http/, "ws"));
  const messages: Seen[] = [];
  const closes: number[] = [];
  ws.addEventListener("message", (event) => messages.push({ ...seen.parse(JSON.parse(String(event.data))), at: performance.now() }));
  ws.addEventListener("close", (event) => closes.push(event.code));
  await new Promise<void>((resolve, reject) => {
    ws.addEventListener("open", () => resolve());
    ws.addEventListener("error", () => reject(new Error("the feed refused the socket")));
  });
  const commit = async (rkey: string, operation = "create", ms = 30_000): Promise<Seen> => {
    const deadline = Date.now() + ms;
    for (;;) {
      const found = messages.find((message) => message.commit?.rkey === rkey && message.commit.operation === operation);
      if (found) return found;
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${operation} ${rkey}; saw ${JSON.stringify(messages)} closes=${JSON.stringify(closes)}`);
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  };
  return { ws, messages, closes, commit };
}
