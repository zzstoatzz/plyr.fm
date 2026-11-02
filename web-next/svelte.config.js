import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
export default {
	preprocess: vitePreprocess(),
	kit: {
		// index.html fallback: cloudflare pages then serves it for every path
		// (SPA mode). a pure client app: every route renders in the browser against the
		// read-only zig appview, and writes go straight to the user's PDS.
		adapter: adapter({ fallback: 'index.html' })
	}
};
