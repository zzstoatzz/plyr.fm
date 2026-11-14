import { fileURLToPath } from 'node:url';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [sveltekit()],
	envPrefix: ['VITE_', 'PUBLIC_'],

	server: {
		host: '127.0.0.1',
		port: 5174,
		strictPort: true,
		fs: { allow: [fileURLToPath(new URL('../', import.meta.url))] }
	}
});
