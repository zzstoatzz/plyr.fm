import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { AT_CLIENTS, DEFAULT_AT_CLIENT, resolveClient } from "./atclients";

const web = readFileSync(new URL("../frontend/src/lib/atclients.ts", import.meta.url), "utf8");

test("the clients are the web's, in its order, with its labels", () => {
  const values = [...web.matchAll(/value: '([^']+)'/g)].map(([, value]) => value);
  const labels = [...web.matchAll(/label: '([^']+)'/g)].map(([, label]) => label);
  expect(values).toEqual(AT_CLIENTS.map((client) => client.value));
  expect(labels).toEqual(AT_CLIENTS.map((client) => client.label));
});

test("each profile link is the web's", () => {
  const links = [...web.matchAll(/profileUrl: \(h\) => `([^`]+)`/g)].map(([, link]) => link?.replace("${h}", "a.test"));
  expect(AT_CLIENTS.map((client) => client.profileUrl("a.test"))).toEqual(links);
});

test("an unknown or missing preference is the default client", () => {
  expect(resolveClient("pdsls").label).toBe("pdsls");
  expect(resolveClient("gone")).toBe(DEFAULT_AT_CLIENT);
  expect(resolveClient(null)).toBe(DEFAULT_AT_CLIENT);
  expect(web).toContain("export const DEFAULT_AT_CLIENT = BSKY.value;");
});
