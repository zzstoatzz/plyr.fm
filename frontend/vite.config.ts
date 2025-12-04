import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import { SvelteKitPWA } from '@vite-pwa/sveltekit';

export default defineConfig({
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
