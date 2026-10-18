import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vitest/config';
import { storybookTest } from '@storybook/addon-vitest/vitest-plugin';
import { playwright } from '@vitest/browser-playwright';
import path from 'node:path';

export default defineConfig({
	plugins: [svelte(), storybookTest({ configDir: path.join(import.meta.dirname, '.storybook') })],
	resolve: {
		alias: {
			$lib: path.resolve(import.meta.dirname, 'src/lib'),
			'$app/environment': path.resolve(import.meta.dirname, 'src/tests/stubs/app-environment.ts'),
			'$app/navigation': path.resolve(import.meta.dirname, 'src/tests/stubs/app-navigation.ts'),
			'$app/stores': path.resolve(import.meta.dirname, 'src/tests/stubs/app-stores.ts'),
			'$env/static/public': path.resolve(
				import.meta.dirname,
				'src/tests/stubs/env-static-public.ts'
			)
		},
		conditions: ['browser']
	},
	test: {
		name: `storybook ${process.env.VITE_STORYBOOK_THEME === 'light' ? 'light' : 'dark'}`,
		browser: {
			enabled: true,
			headless: true,
			provider: playwright(),
			instances: [{ browser: 'chromium' }]
		}
	}
});
