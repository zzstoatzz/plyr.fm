import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Text below heading size uses the --t-* steps in web/src/app.css, so neighbours always match.
// Allowed raw: the root's 100%, headings from 1.2rem up, clamp() display titles starting there,
// and the 16px field floor.
const root = fileURLToPath(new URL('../web/src/', import.meta.url));
const steps = new Set([...readFileSync(path.join(root, 'app.css'), 'utf8').matchAll(/^\s*(--t-[\d-]+):/gm)].map(match => match[1]));
const floor = new Set(['100%', '16px', 'max(16px, 1rem)', 'max(1rem, 16px)', 'inherit']);
const failures = [];

function filesIn(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) return filesIn(file);
    return /\.(?:svelte|css)$/.test(entry.name) ? [file] : [];
  });
}

const heading = value => { const rem = /^([\d.]+)rem$/.exec(value); return !!rem && Number(rem[1]) >= 1.2; };

/** Why a size is not allowed, or nothing when it is. */
function problem(size) {
  const token = /^var\((--t-[\d-]+)\)$/.exec(size);
  if (token) return steps.has(token[1]) ? undefined : `${token[1]} is not a step in app.css`;
  if (floor.has(size) || heading(size)) return;
  const clamp = /^clamp\(\s*([^,]+),/.exec(size);
  if (clamp && heading(clamp[1].trim())) return;
  return 'use a --t-* step from app.css';
}

for (const file of filesIn(root)) {
  // Declarations, not lines: a value can wrap onto the next line.
  const source = readFileSync(file, 'utf8');
  for (const match of source.matchAll(/(?<![\w-])font(-size)?\s*:\s*([^;"'}]+)/g)) {
    const value = match[2].replace(/!important/, '').trim();
    // In the shorthand, the size is what comes before an optional /line-height and the family.
    const size = match[1] ? value : /(?:^|\s)(var\(--[\w-]+\)|[\d.]+(?:rem|px|em|%))(?=\s*\/|\s)/.exec(value)?.[1];
    if (!size) continue;
    const why = problem(size);
    if (!why) continue;
    const line = source.slice(0, match.index).split('\n').length;
    failures.push(`${path.relative(root, file)}:${line} ${match[0].trim()}: ${why}`);
  }
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log('type scale: every size below 1.2rem uses a --t-* step');
