import { fileURLToPath } from 'node:url';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import { SvelteKitPWA } from '@vite-pwa/sveltekit';

export default defineConfig({
	resolve: {
		// @atproto/api does `import TLDs from 'tlds' with { type: 'json' }`;
		// resolving 'tlds' straight to its JSON lets vite inline it, so the
		// import-attributes syntax never survives into any emitted chunk
		// (CF Pages' wrangler 3.x cannot parse it — see #1949/#1950)
		alias: { tlds: fileURLToPath(new URL('./node_modules/tlds/index.json', import.meta.url)) }
	},
	ssr: {
		// bundle it server-side too: left external, its dist files reach the
		// CF Pages functions bundler verbatim, import attributes included
		noExternal: ['@atproto/api']
	},
	plugins: [
		sveltekit(),
		SvelteKitPWA({
			strategies: 'generateSW',
			registerType: 'autoUpdate',
			manifest: false,
			workbox: {
				globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
				runtimeCaching: [
					{
						// audio streaming: bypass SW entirely to avoid iOS PWA hangs
						// (the redirect to R2 CDN + range requests don't play well with caching)
						urlPattern: /^https:\/\/api\.plyr\.fm\/audio\/.*/i,
						handler: 'NetworkOnly'
					},
					{
						urlPattern: /^https:\/\/api\.plyr\.fm\/.*/i,
						handler: 'NetworkFirst',
						options: {
							cacheName: 'api-cache',
							expiration: {
								maxEntries: 50,
								maxAgeSeconds: 60 * 60
							}
						}
					}
				]
			}
		})
	]
});
