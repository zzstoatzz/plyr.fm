// Adds the link-preview worker to the static build: `build/_worker.js` (Cloudflare
// Pages "advanced mode") and `build/_routes.json`, which sends only the shareable
// pages and /oembed through it. Everything else stays a plain static asset.
import { readFile, writeFile } from 'node:fs/promises';

const api = (process.env.PUBLIC_API_URL || 'https://api.next.plyr.fm').replace(/\/$/, '');
const source = await readFile(new URL('../edge/link-preview.js', import.meta.url), 'utf8');
const playlists = JSON.parse(await readFile(new URL('../edge/legacy-playlists.json', import.meta.url), 'utf8'));
const llms = await readFile(new URL('../edge/llms.txt', import.meta.url), 'utf8');
for (const placeholder of ["'__PLYR_API_ORIGIN__'", '/* legacy-playlists */ {}', "/* llms-txt */ ''"]) {
  if (!source.includes(placeholder)) throw new Error(`link-preview.js lost its ${placeholder} placeholder`);
}
await writeFile(
  new URL('../build/_worker.js', import.meta.url),
  source.replace("'__PLYR_API_ORIGIN__'", () => JSON.stringify(api)).replace('/* legacy-playlists */ {}', () => JSON.stringify(playlists)).replace("/* llms-txt */ ''", () => JSON.stringify(llms))
);
await writeFile(
  new URL('../build/_routes.json', import.meta.url),
  JSON.stringify({ version: 1, include: ['/', '/atlas', '/radio', '/radio/*', '/track/*', '/u/*', '/album/*', '/playlist/*', '/tag/*', '/jam/*', '/oembed', '/og/*', '/embed/playlist/*', '/embed/album/*', '/robots.txt', '/sitemap.xml', '/llms.txt', '/liked/*', '/for-you', '/activity', '/record', '/costs', '/profile/*', '/portal/*', '/at/*'], exclude: [] }, null, 2) + '\n'
);
console.log(`link previews: build/_worker.js reads ${api}, maps ${Object.keys(playlists).length} production playlist ids`);
