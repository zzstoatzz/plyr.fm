/** An AT Protocol client a profile can be opened in. The same list as the web's `frontend/src/lib/atclients.ts`. */
export type AtClient = { value: string; label: string; profileUrl: (handleOrDid: string) => string };

export const AT_CLIENTS = [
  { value: "bsky", label: "bluesky", profileUrl: (h) => `https://bsky.app/profile/${h}` },
  { value: "blacksky", label: "blacksky", profileUrl: (h) => `https://blacksky.community/profile/${h}` },
  { value: "witchsky", label: "witchsky", profileUrl: (h) => `https://witchsky.app/profile/${h}` },
  { value: "reddwarf", label: "red dwarf", profileUrl: (h) => `https://reddwarf.app/profile/${h}` },
  { value: "pdsls", label: "pdsls", profileUrl: (h) => `https://pdsls.dev/at/${h}` },
] as const satisfies readonly AtClient[];

export const DEFAULT_AT_CLIENT = AT_CLIENTS[0];

/** The client a stored preference names; an unknown or missing one is the default. */
export function resolveClient(value: string | null | undefined): AtClient {
  return AT_CLIENTS.find((client) => client.value === value) ?? DEFAULT_AT_CLIENT;
}
