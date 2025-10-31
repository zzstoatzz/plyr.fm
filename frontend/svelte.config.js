import adapter from '@sveltejs/adapter-cloudflare';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),

	kit: {
		adapter: adapter({
			platformProxy: {
				configPath: 'wrangler.toml',
				experimentalJsonConfig: false,
				persist: false
			}
		})
	}
};

export default config;
