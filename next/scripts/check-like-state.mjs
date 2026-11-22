// A like has one state: core/src/track-likes.ts holds whether you like a track, its count and who liked it, and
// each client keeps one instance of it. A surface that reads the count off the track, fetches likers or reads your
// likes itself keeps its own copy, which goes stale the moment you like from somewhere else. This keeps them out.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const stores = new Set(['web/src/lib/listening/likes.ts', 'app/src/likes.ts']);
// Counts that are not the live like: an owner's catalog stats, a ranking score, a row helper whose callers pass the shared count.
const allowed = new Map([
  ['web/src/lib/catalog/CreatorPortal.svelte', 'the owner\'s catalog stats, read as a report'],
  ['app/src/Portal.tsx', 'the owner\'s catalog stats, read as a report'],
  ['app/src/home-state.ts', 'a ranking score for whose tracks you like'],
  ['app/src/CatalogPieces.tsx', 'trackMeta, whose callers pass useTrackLike().count'],
]);

function filesIn(directory, pattern) {
  return readdirSync(path.join(root, directory), { withFileTypes: true }).flatMap(entry => {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) return filesIn(file, pattern);
    return pattern.test(entry.name) ? [file] : [];
  });
}

const failures = [];
for (const file of [...filesIn('web/src', /\.(svelte|ts)$/), ...filesIn('app/src', /\.tsx?$/)]) {
  if (stores.has(file)) continue;
  const source = readFileSync(path.join(root, file), 'utf8');
  if (/\.trackLikes\(/.test(source)) failures.push(`${file}: fetches who liked a track itself; read likers(track) from the shared like state`);
  if (/\.myLikes\(\)/.test(source)) failures.push(`${file}: reads your likes itself; read snapshot(track) from the shared like state`);
  if (/\blike_count\b/.test(source) && !allowed.has(file)) failures.push(`${file}: shows track.metrics.like_count, which a like doesn't change; read the count from the shared like state`);
}
if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log('like state: every heart, count and likers list reads the shared like state');
