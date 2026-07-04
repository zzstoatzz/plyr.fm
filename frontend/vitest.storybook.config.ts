import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vitest/config';
import { storybookTest } from '@storybook/addon-vitest/vitest-plugin';
import { playwright } from '@vitest/browser-playwright';
import path from 'node:path';

// dedicated config for the storybook accessibility gate — kept separate from
// vitest.config.ts so the everyday `bun run test` (jsdom unit tests) never pulls
// in a browser or Playwright. this runs each story in real chromium and, with
// a11y.test='error' in .storybook/preview.ts, fails on axe violations.
//
// the svelte plugin + these $lib/$app/$env aliases mirror vitest.config.ts so
// stories (and storybook's own internal .svelte components) compile and resolve
// the same way the unit tests do; keep them in sync.
export default defineConfig({
	plugins: [
		svelte(),
		storybookTest({ configDir: path.join(import.meta.dirname, '.storybook') })
	],
	resolve: {
		alias: {
			$lib: path.resolve(import.meta.dirname, 'src/lib'),
			'$app/environment': path.resolve(import.meta.dirname, 'src/tests/stubs/app-environment.ts'),
			'$app/navigation': path.resolve(import.meta.dirname, 'src/tests/stubs/app-navigation.ts'),
			'$app/stores': path.resolve(import.meta.dirname, 'src/tests/stubs/app-stores.ts'),
			'$env/static/public': path.resolve(import.meta.dirname, 'src/tests/stubs/env-static-public.ts')
		},
		conditions: ['browser']
	},
	test: {
		name: 'storybook',
		browser: {
			enabled: true,
			headless: true,
			provider: playwright(),
			instances: [{ browser: 'chromium' }]
		}
	}
});
