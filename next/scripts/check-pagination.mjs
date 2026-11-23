// Every paged list loads its next page as you scroll, the way home's latest tracks do. On web that is
// web/src/lib/ui/LoadMore.svelte; on iOS and Android it is app/src/LoadMore.tsx inside a scroll view that
// provides behaviors/scroll-edge.ts. This keeps new lists from growing a "more X" button of their own.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const primitives = new Set(['web/src/lib/ui/LoadMore.svelte', 'app/src/LoadMore.tsx']);

function filesIn(directory, pattern) {
  return readdirSync(path.join(root, directory), { withFileTypes: true }).flatMap(entry => {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) return filesIn(file, pattern);
    return pattern.test(entry.name) ? [file] : [];
  });
}

// "more", "more playlists", "show more", "load more results", "see more · 3 left" …
const moreText = /^\s*(?:show |load |see |view )?more\b(?! options| actions|$)/i;
const failures = [];
const fail = (file, line, message) => failures.push(`${file}:${line}: ${message}`);

for (const file of filesIn('web/src', /\.svelte$/)) {
  if (primitives.has(file)) continue;
  readFileSync(path.join(root, file), 'utf8').split('\n').forEach((text, index) => {
    for (const [, attributes, label] of text.matchAll(/<button((?:=>|[^>])*)>([^<]*)<\/button>/g)) {
      const words = label.replace(/\{[^}]*'([^']*)'\s*\}/g, ' $1 ').replace(/\{[^}]*\}/g, ' ');
      if (moreText.test(words) || /'(?:show |load )?more\b[^']*'\s*\}/i.test(label)) fail(file, index + 1, `a "${label.trim()}" button pages by hand; use $lib/ui/LoadMore.svelte`);
      else if (/onclick=\{[^}]*(?:\.more\(|\.more\}|more: true)/.test(attributes)) fail(file, index + 1, 'a button loads the next page; use $lib/ui/LoadMore.svelte');
    }
  });
}

for (const file of filesIn('app/src', /\.tsx$/)) {
  if (primitives.has(file)) continue;
  readFileSync(path.join(root, file), 'utf8').split('\n').forEach((text, index) => {
    for (const [, label] of text.matchAll(/label=(?:"([^"]*)"|\{`([^`]*)`\}|\{'([^']*)'\})/g).map(match => [match[0], match[1] ?? match[2] ?? match[3]])) {
      if (moreText.test(label.replace(/\$\{[^}]*\}/g, 'x'))) fail(file, index + 1, `a "${label}" control pages by hand; use LoadMore from app/src/LoadMore.tsx`);
    }
    if (/onPress=\{[^}]*(?:\.more\b(?!\w)|more: true)/.test(text) && !/retry/i.test(text)) fail(file, index + 1, 'a control loads the next page; use LoadMore from app/src/LoadMore.tsx');
  });
}

if (failures.length) {
  console.error('pagination:\n' + failures.map(line => `  ${line}`).join('\n'));
  process.exit(1);
}
console.log('pagination: every paged list loads as it scrolls');
