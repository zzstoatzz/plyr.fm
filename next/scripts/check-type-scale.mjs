import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Text below heading size uses the --t-* steps in web/src/app.css, so neighbours always match.
// Allowed raw: headings from 1.2rem up, clamp() display titles, and the 16px field floor.
const root = fileURLToPath(new URL('../web/src/', import.meta.url));
const allowed = /^(?:var\(--t-[\d-]+\)|clamp\(.+\)|max\(16px, 1rem\)|max\(1rem, 16px\)|16px|inherit|[\d.]+rem)$/;
const failures = [];

function filesIn(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) return filesIn(file);
    return /\.(?:svelte|css)$/.test(entry.name) ? [file] : [];
  });
}

for (const file of filesIn(root)) {
  readFileSync(file, 'utf8').split('\n').forEach((line, index) => {
    for (const match of line.matchAll(/font-size:\s*([^;"'}]+)/g)) {
      const value = match[1].trim();
      const rem = /^([\d.]+)rem$/.exec(value);
      if (allowed.test(value) && !(rem && Number(rem[1]) < 1.2)) continue;
      failures.push(`${path.relative(root, file)}:${index + 1} font-size: ${value} (use a --t-* step from app.css)`);
    }
  });
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log('type scale: every size below 1.2rem uses a --t-* step');
