import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

// atproto oauth forbids `localhost`; loopback dev uses 127.0.0.1.
export default defineConfig({
	plugins: [sveltekit()],
	envPrefix: ['VITE_', 'PUBLIC_'],
	server: { host: '127.0.0.1', port: 5174 }
});
