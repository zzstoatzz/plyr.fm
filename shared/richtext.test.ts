import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { richText } from "./richtext";

test("bare URLs, markdown links and domain/path become links; the rest stays text", () => {
  expect(richText("demo at https://a.test/x, notes [here](https://b.test) and github.com/zzstoatzz/plyr.fm.")).toEqual([
    { type: "text", content: "demo at " },
    { type: "link", content: "https://a.test/x,", href: "https://a.test/x," },
    { type: "text", content: " notes " },
    { type: "link", content: "here", href: "https://b.test" },
    { type: "text", content: " and " },
    { type: "link", content: "github.com/zzstoatzz/plyr.fm.", href: "https://github.com/zzstoatzz/plyr.fm." },
  ]);
});

test("text without links is one run, and nothing is nothing", () => {
  expect(richText("recorded in a kitchen. v2")).toEqual([{ type: "text", content: "recorded in a kitchen. v2" }]);
  expect(richText("")).toEqual([]);
});

test("a link never opens anything but http(s)", () => {
  for (const part of richText("javascript:alert(1) [x](javascript:alert(1)) www.a.test")) if (part.type === "link") expect(part.href).toMatch(/^https?:\/\//);
});

test("the pattern is RichText.svelte's", () => {
  const source = readFileSync(new URL("../frontend/src/lib/components/RichText.svelte", import.meta.url), "utf8");
  expect(source).toContain("/\\[([^\\]]+)\\]\\((https?:\\/\\/[^\\s)]+)\\)|(https?:\\/\\/[^\\s<>)\\]]+|www\\.[^\\s<>)\\]]+|[a-z0-9][-a-z0-9]*\\.[a-z]{2,}\\/[^\\s<>)\\]]+)/gi;");
  expect(source).toContain("href = 'https://' + href;");
});
