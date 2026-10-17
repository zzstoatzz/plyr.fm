import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { supportUrl } from "./support";

test("the atprotofans choice becomes the artist's atprotofans page, as on the web", () => {
  expect(supportUrl({ did: "did:plc:a", support_url: "atprotofans" })).toBe("https://atprotofans.com/support/did:plc:a");
  const config = readFileSync(new URL("../frontend/src/lib/config.ts", import.meta.url), "utf8");
  expect(config).toContain("return `https://atprotofans.com/support/${did}`;");
  const page = readFileSync(new URL("../frontend/src/routes/u/[handle]/+page.svelte", import.meta.url), "utf8");
  expect(page).toContain("artist.support_url === 'atprotofans'");
});

test("an artist's own https link passes through; nothing else opens", () => {
  expect(supportUrl({ did: "d", support_url: "https://ko-fi.com/a" })).toBe("https://ko-fi.com/a");
  for (const support_url of [null, undefined, "", "javascript:alert(1)", "http://a.test"]) expect(supportUrl({ did: "d", support_url })).toBeNull();
});
