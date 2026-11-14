import { type Env, SpaceFeed } from "./feed";
import { type SpaceUri, confirmation, notification, readSubscription, renewal } from "./wire";

export { SpaceFeed };

const fail = (error: string, status: number) => Response.json({ error }, { status });
const invalid = () => fail("InvalidRequest", 400);
const feed = (env: Env, space: string) => env.FEED.get(env.FEED.idFromName(space));
// A deployment can serve only the space types it is for, so it cannot be pointed at any space.
const served = (env: Env, space: SpaceUri) => {
  const types = env.SPACE_TYPES?.split(",").map((type) => type.trim()).filter(Boolean) ?? [];
  return types.length === 0 || types.includes(space.split("/")[4] ?? "");
};
const unserved = () => fail("SpaceTypeNotServed", 403);

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    // Space hosts call the update methods under the origin consumers reach this worker at.
    const endpoint = url.origin;

    if (url.pathname === "/subscribe") {
      if (request.headers.get("upgrade") !== "websocket") return invalid();
      const wanted = readSubscription(url);
      if (!wanted.success) return invalid();
      if (!served(env, wanted.data.space)) return unserved();
      // A socket cannot cross an RPC call, so the upgrade request itself goes to the feed.
      return feed(env, wanted.data.space).fetch(request);
    }

    if (request.method !== "POST") return fail("NotFound", 404);
    const body: unknown = await request.json().catch(() => null);

    if (url.pathname === "/renew") {
      const parsed = renewal.safeParse(body);
      if (!parsed.success) return invalid();
      const { space, ...lent } = parsed.data;
      if (!served(env, space)) return unserved();
      return feed(env, space).renew(space, endpoint, lent);
    }
    if (url.pathname === "/xrpc/com.atproto.space.confirmRegistration") {
      const parsed = confirmation.safeParse(body);
      if (!parsed.success) return invalid();
      const { space, token, challenge } = parsed.data;
      return (await feed(env, space).issued(space, token)) ? Response.json({ challenge }) : fail("InvalidToken", 401);
    }
    if (url.pathname === "/xrpc/com.atproto.space.notifySpaceUpdate") {
      const parsed = notification.safeParse(body);
      if (!parsed.success) return invalid();
      const { space, token, update } = parsed.data;
      return (await feed(env, space).notify(space, token, update.$type)) ? Response.json({}) : fail("InvalidToken", 401);
    }
    return fail("NotFound", 404);
  },
};
