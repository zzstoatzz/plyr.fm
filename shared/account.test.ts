import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import baseline from "../docs/internal/contracts/client-api.json";
import {
  CurrentUser,
  PdsOptions,
  SIGN_IN_MESSAGES,
  TYPEAHEAD_ORIGIN,
  canSignIn,
  normalizeIdentifier,
  parseActors,
  parseAuthStart,
  parseSession,
  parseSignupHost,
  readAuthReturn,
  signInFailure,
  typeaheadPath,
} from "./account";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("the typeahead host is the web's", () => {
  expect(read("../frontend/src/lib/config.ts")).toContain(`export const TYPEAHEAD_URL = '${TYPEAHEAD_ORIGIN}';`);
});

test("the typeahead request names the lexicon method and escapes the query", () => {
  expect(typeaheadPath("a b&c")).toBe("/xrpc/app.bsky.actor.searchActorsTypeahead?q=a%20b%26c&limit=6");
});

test("a malformed actor is dropped and a missing list is empty", () => {
  const good = {
    did: "did:plc:a",
    handle: "a.test",
    displayName: "A",
    avatar: null,
  };
  expect(parseActors({ actors: [good, { handle: "no-did.test" }, 3] })).toEqual([good]);
  expect(parseActors({})).toEqual([]);
});

test("a typed handle loses its prefix and case; a DID keeps its bytes", () => {
  expect(normalizeIdentifier("  @Nate.Example.COM ")).toBe("nate.example.com");
  expect(normalizeIdentifier("at://zzstoatzz.io")).toBe("zzstoatzz.io");
  expect(normalizeIdentifier("did:web:Example.com:User")).toBe("did:web:Example.com:User");
});

test("only a domain or a DID can start sign-in", () => {
  expect(canSignIn("zzstoatzz.io")).toBe(true);
  expect(canSignIn("a.bsky.social")).toBe(true);
  expect(canSignIn("did:plc:abc123")).toBe(true);
  expect(canSignIn("nate")).toBe(false);
  expect(canSignIn("nate.")).toBe(false);
  expect(canSignIn("did:")).toBe(false);
  expect(canSignIn("two words.com")).toBe(false);
});

test("every field read from /auth/me is served", () => {
  const schemas = baseline.components.schemas as Record<string, { properties: Record<string, unknown>; required?: string[] }>;
  for (const field of Object.keys(CurrentUser.shape)) expect(schemas.CurrentUserResponse.properties).toHaveProperty(field);
  expect(schemas.CurrentUserResponse.required).toEqual(expect.arrayContaining(["did", "handle"]));
  for (const field of Object.keys(CurrentUser.shape.linked_accounts.unwrap().element.shape))
    expect(schemas.LinkedAccountResponse.properties).toHaveProperty(field);
});

test("every field read from /auth/pds-options is one the backend's models declare", () => {
  const backend = read("../backend/src/backend/api/auth.py");
  const model = (name: string) => backend.slice(backend.indexOf(`class ${name}(BaseModel)`)).split("\n\n\n")[0];
  for (const field of Object.keys(PdsOptions.shape)) expect(model("PdsOptionsResponse")).toContain(`    ${field}:`);
  for (const field of Object.keys(PdsOptions.shape.options.unwrap().element.shape)) expect(model("PdsOption")).toContain(`    ${field}:`);
});

test("a new account goes to the recommended host, or nowhere when creation is off", () => {
  const first = { name: "first.example", url: "https://first.example" };
  const best = {
    name: "best.example",
    url: "https://best.example",
    recommended: true,
  };
  expect(parseSignupHost({ enabled: true, options: [first, best] })?.name).toBe("best.example");
  expect(parseSignupHost({ enabled: true, options: [first] })?.name).toBe("first.example");
  expect(parseSignupHost({ enabled: false, options: [first, best] })).toBeNull();
  expect(parseSignupHost({ enabled: true, options: [] })).toBeNull();
});

test("an unknown failure code is a plain failure, and only closing the sheet is silent", () => {
  expect(signInFailure("handle_not_found")).toBe("handle_not_found");
  expect(signInFailure("scope_mismatch")).toBe("failed");
  expect(signInFailure(null)).toBe("failed");
  const silent = Object.entries(SIGN_IN_MESSAGES).filter(([, message]) => message === null);
  expect(silent.map(([failure]) => failure)).toEqual(["cancelled"]);
});

test("the return address carries a code or a failure, never both", () => {
  expect(readAuthReturn("fm.plyr://auth?code=a-b_c%3D")).toEqual({
    code: "a-b_c=",
  });
  expect(readAuthReturn("fm.plyr://auth?error=access_denied")).toEqual({
    failure: "access_denied",
  });
  expect(readAuthReturn("fm.plyr://auth?error=whatever")).toEqual({
    failure: "failed",
  });
  expect(readAuthReturn("fm.plyr://auth")).toEqual({ failure: "failed" });
});

test("the start and exchange answers are read by name", () => {
  expect(parseAuthStart({ auth_url: "https://pds.example/authorize" })).toBe("https://pds.example/authorize");
  expect(parseSession({ session_id: "s" })).toBe("s");
  expect(() => parseSession({ session_id: null })).toThrow();
});
