/// <reference types="node" />

import { copyFile, readFile, writeFile } from 'node:fs/promises';
import { URL } from 'node:url';
import * as config from '../src/auth-config.ts';
import { oauthMetadata } from '../../core/src/oauth-metadata.ts';
import { HOME_PAGE_SIZE } from '../src/home-state.ts';

for (const applicationType of ['web', 'native'] as const) {
	const native = applicationType === 'native';
	const filename = native ? 'oauth-native-client-metadata.json' : 'oauth-client-metadata.json';
	const metadata = oauthMetadata(config, applicationType);
	await writeFile(new URL(`../dist/${filename}`, import.meta.url), JSON.stringify(metadata) + '\n');
}

const apiOrigin = new URL(process.env.EXPO_PUBLIC_API_URL || 'https://api.next.plyr.fm').origin;
const htmlPath = new URL('../dist/index.html', import.meta.url);
const html = await readFile(htmlPath, 'utf8');
const preload = `<script>
if (!location.pathname.startsWith('/embed/')) {
  let theme;
  try { theme = JSON.parse(localStorage.getItem('plyr-next:prefs') || '{}').theme; } catch {}
  const dark = theme === 'dark' || (theme !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
  const background = dark ? '#10131a' : '#fbfbfd';
  document.documentElement.style.backgroundColor = background;
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
  const style = document.createElement('style');
  style.textContent = 'body { background-color: inherit; }';
  document.head.append(style);
  const meta = document.createElement('meta');
  meta.name = 'theme-color';
  meta.content = background;
  document.head.append(meta);
}
if (location.pathname === '/') {
  const link = document.createElement('link');
  link.rel = 'preload';
  link.as = 'fetch';
  link.crossOrigin = 'anonymous';
  link.href = ${JSON.stringify(apiOrigin + `/v1/tracks?limit=${HOME_PAGE_SIZE}`).replaceAll('<', '\\u003c')};
  document.head.append(link);
}
</script>`;
await writeFile(htmlPath, html.replace('</head>', '<link rel="icon" href="/favicon.ico" type="image/x-icon"><link rel="apple-touch-icon" href="/apple-touch-icon.png">' + preload + '</head>'));

await copyFile(new URL('../../web/static/private-audio-worker.js', import.meta.url), new URL('../dist/private-audio-worker.js', import.meta.url));
