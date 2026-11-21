// Adds the link-preview worker to the static build: `build/_worker.js` (Cloudflare
// Pages "advanced mode") and `build/_routes.json`, which sends only the shareable
// pages and /oembed through it. Everything else stays a plain static asset.
import { readFile, writeFile } from 'node:fs/promises';

const api = (process.env.PUBLIC_API_URL || 'https://api.next.plyr.fm').replace(/\/$/, '');
const source = await readFile(new URL('../edge/link-preview.js', import.meta.url), 'utf8');
if (!source.includes("'__PLYR_API_ORIGIN__'")) throw new Error('link-preview.js lost its api origin placeholder');
await writeFile(new URL('../build/_worker.js', import.meta.url), source.replace("'__PLYR_API_ORIGIN__'", JSON.stringify(api)));
await writeFile(
  new URL('../build/_routes.json', import.meta.url),
  JSON.stringify({ version: 1, include: ['/', '/track/*', '/u/*', '/album/*', '/playlist/*', '/tag/*', '/jam/*', '/oembed'], exclude: [] }, null, 2) + '\n'
);
console.log(`link previews: build/_worker.js reads ${api}`);
