import { z } from "zod";
import type { Body } from "./contract";

/** The actor search every app here uses; the web's `TYPEAHEAD_URL` (account.test.ts holds this). */
export const TYPEAHEAD_ORIGIN = "https://typeahead.waow.tech";
export const TYPEAHEAD_CLIENT = "plyr.fm";
export const TYPEAHEAD_MIN_LENGTH = 2;
export const TYPEAHEAD_LIMIT = 6;

/** `app.bsky.actor.searchActorsTypeahead`, as a path and query on the typeahead origin. */
export function typeaheadPath(query: string): string {
  return `/xrpc/app.bsky.actor.searchActorsTypeahead?q=${encodeURIComponent(query)}&limit=${TYPEAHEAD_LIMIT}`;
}

export const Actor = z.object({
  did: z.string(),
  handle: z.string(),
  displayName: z.string().nullish(),
  avatar: z.string().nullish(),
});
export type Actor = z.infer<typeof Actor>;

/** One malformed actor is dropped; suggestions are a convenience and never fail the form. */
export function parseActors(body: Body): Actor[] {
  const { actors } = z.object({ actors: z.array(z.unknown()).default([]) }).parse(body);
  return actors.flatMap((actor) => {
    const parsed = Actor.safeParse(actor);
    return parsed.success ? [parsed.data] : [];
  });
}

/**
 * What a person typed, as the identifier sign-in is started with: `at://` and a leading `@` go, a handle is
 * lowercased, and a DID keeps its bytes (a `did:web` path is case-sensitive).
 */
export function normalizeIdentifier(typed: string): string {
  const bare = typed
    .trim()
    .replace(/^at:\/\//i, "")
    .replace(/^@/, "");
  return bare.toLowerCase().startsWith("did:") ? bare : bare.toLowerCase();
}

/** A handle is a domain, so it has a dot in it; a DID names its method. */
export function canSignIn(identifier: string): boolean {
  if (identifier.startsWith("did:")) return /^did:[a-z]+:.+/.test(identifier);
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(identifier);
}

/** `GET /auth/me`: who the session belongs to. */
export const CurrentUser = z.object({
  did: z.string(),
  handle: z.string(),
  linked_accounts: z
    .array(
      z.object({
        did: z.string(),
        handle: z.string(),
        avatar_url: z.string().nullable(),
      }),
    )
    .default([]),
});
export type CurrentUser = z.infer<typeof CurrentUser>;

export function parseCurrentUser(body: Body): CurrentUser {
  return CurrentUser.parse(body);
}

/** `GET /auth/pds-options`: the hosts a new account can be made on. */
export const PdsOptions = z.object({
  enabled: z.boolean(),
  options: z
    .array(
      z.object({
        name: z.string(),
        url: z.string(),
        recommended: z.boolean().default(false),
        description: z.string().nullish(),
      }),
    )
    .default([]),
});
export type PdsOption = z.infer<typeof PdsOptions>["options"][number];

/** The host a new account is sent to: the recommended one, else the first. None when creation is off. */
export function parseSignupHost(body: Body): PdsOption | null {
  const { enabled, options } = PdsOptions.parse(body);
  if (!enabled) return null;
  return options.find((option) => option.recommended) ?? options[0] ?? null;
}

/** Why a sign-in did not finish, as the backend and the authorization server report it. */
export type SignInFailure = "cancelled" | "handle_not_found" | "access_denied" | "expired" | "unreachable" | "failed";

export function signInFailure(code: string | null): SignInFailure {
  if (code === "handle_not_found" || code === "access_denied" || code === "expired") return code;
  return "failed";
}

/** One plain sentence per failure; a sign-in the person closed themselves says nothing. */
export const SIGN_IN_MESSAGES: Record<SignInFailure, string | null> = {
  cancelled: null,
  handle_not_found: "couldn’t find that handle.",
  access_denied: "sign-in was cancelled.",
  expired: "that sign-in expired. try again.",
  unreachable: "couldn’t reach plyr.fm. check your connection.",
  failed: "that sign-in didn’t finish. try again.",
};

/** `POST /auth/app/start`: where the system auth session opens. */
export function parseAuthStart(body: Body): string {
  return z.object({ auth_url: z.string() }).parse(body).auth_url;
}

/** `POST /auth/exchange` for a native sign-in: the session id the app sends as a bearer token. */
export function parseSession(body: Body): string {
  return z.object({ session_id: z.string() }).parse(body).session_id;
}

/** What the backend put on the app's return address: a one-time code, or why there is none. */
export function readAuthReturn(url: string): { code: string } | { failure: SignInFailure } {
  const query = url.includes("?") ? url.slice(url.indexOf("?") + 1).split("#")[0] : "";
  const params = new Map(query.split("&").map((pair) => pair.split("=").map(decodeURIComponent) as [string, string | undefined]));
  const code = params.get("code");
  return code ? { code } : { failure: signInFailure(params.get("error") ?? null) };
}
