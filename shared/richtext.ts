export type TextPart = { type: "text"; content: string } | { type: "link"; content: string; href: string };

// same pattern and rules as frontend/src/lib/components/RichText.svelte; richtext.test.ts holds it
const LINKS = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<>)\]]+|www\.[^\s<>)\]]+|[a-z0-9][-a-z0-9]*\.[a-z]{2,}\/[^\s<>)\]]+)/gi;

/** Split text into plain runs and links: bare URLs, `[text](url)`, and `domain.tld/path`. */
export function richText(input: string): TextPart[] {
  const parts: TextPart[] = [];
  let last = 0;
  for (const match of input.matchAll(LINKS)) {
    if (match.index > last) parts.push({ type: "text", content: input.slice(last, match.index) });
    if (match[1] && match[2]) parts.push({ type: "link", content: match[1], href: match[2] });
    else parts.push({ type: "link", content: match[3], href: /^https?:\/\//.test(match[3]) ? match[3] : `https://${match[3]}` });
    last = match.index + match[0].length;
  }
  if (last < input.length) parts.push({ type: "text", content: input.slice(last) });
  return parts;
}
