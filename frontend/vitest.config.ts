import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
	plugins: [svelte()],
	resolve: {
		alias: {
			$lib: path.resolve(import.meta.dirname, 'src/lib'),
			'$app/environment': path.resolve(import.meta.dirname, 'src/tests/stubs/app-environment.ts'),
			'$app/stores': path.resolve(import.meta.dirname, 'src/tests/stubs/app-stores.ts'),
			'$env/static/public': path.resolve(import.meta.dirname, 'src/tests/stubs/env-static-public.ts')
		},
		// resolve svelte's client runtime (not SSR) so mount() works under jsdom
		conditions: ['browser']
	},
	test: {
		environment: 'jsdom',
		include: ['src/**/*.test.ts']
	}
});
