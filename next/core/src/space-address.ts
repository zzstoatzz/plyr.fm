// plyr names spaces the way its records were published: at://{did}/space/{type}/{skey},
// and a record in one as that plus /{repo}/{collection}/{rkey}. Track ids, audioSpace,
// policy records and the index all keep that form.
// Space PDSes (zds 0.18.3, 2026-11-24) take and answer only at:space/{did}/{type}/{skey}[/…].
// Convert at the PDS edge only: toSpaceWire on the way out, fromSpaceWire on the way back.

const STORED = /^at:\/\/(did:[a-z]+:[^/?#]+)\/space\/([^?#]+)$/;
const WIRE = /^at:space\/(did:[a-z]+:[^/?#]+)\/([^?#]+)$/;

/** the address a space PDS accepts, from either form */
export function toSpaceWire(uri: string): string {
  const match = STORED.exec(uri);
  return match ? `at:space/${match[1]}/${match[2]}` : uri;
}

/** the address plyr stores, from either form */
export function fromSpaceWire(uri: string): string {
  const match = WIRE.exec(uri);
  return match ? `at://${match[1]}/space/${match[2]}` : uri;
}

/** a PDS answer with every space address in it back in plyr's form */
export function fromSpaceWireDeep<T>(value: T): T {
  if (typeof value === 'string') return fromSpaceWire(value) as T;
  if (Array.isArray(value)) return value.map(fromSpaceWireDeep) as T;
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, fromSpaceWireDeep(item)])) as T;
  }
  return value;
}

/** `/xrpc/{method}` with its `space` parameter in the PDS's form */
export function spaceXrpcPath(method: string, params?: Record<string, string>): string {
  if (!params) return `/xrpc/${method}`;
  const wire = 'space' in params ? { ...params, space: toSpaceWire(params.space) } : params;
  return `/xrpc/${method}?${new URLSearchParams(wire)}`;
}

/** a request body with its `space` in the PDS's form */
export function spaceXrpcBody<T extends object>(body: T): T {
  return 'space' in body && typeof body.space === 'string' ? { ...body, space: toSpaceWire(body.space) } : body;
}
