/// <reference types="node" />

import { readFile, writeFile } from 'node:fs/promises';
import { URL } from 'node:url';
import { NATIVE_REDIRECT_URI, SCOPE_PARTS, SITE_URL } from '../src/auth-config.ts';

for (const applicationType of ['web', 'native'] as const) {
	const native = applicationType === 'native';
	const filename = native ? 'oauth-native-client-metadata.json' : 'oauth-client-metadata.json';
	const metadata = {
		client_id: `${SITE_URL}/${filename}`,
		client_name: 'plyr.fm (next)',
		client_uri: SITE_URL,
		redirect_uris: [native ? NATIVE_REDIRECT_URI : `${SITE_URL}/oauth/callback`],
		scope: SCOPE_PARTS.join(' '),
		grant_types: ['authorization_code', 'refresh_token'],
		response_types: ['code'],
		token_endpoint_auth_method: 'none',
		application_type: applicationType,
		dpop_bound_access_tokens: true
	};
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
  link.href = ${JSON.stringify(apiOrigin + '/v1/tracks?limit=30').replaceAll('<', '\\u003c')};
  document.head.append(link);
}
</script>`;
await writeFile(htmlPath, html.replace('</head>', preload + '</head>'));
