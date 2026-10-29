import assert from 'node:assert/strict';
import path from 'node:path';
import { createServer } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { chromium, webkit } from 'playwright';

const root = path.resolve(import.meta.dirname, '..');
const server = await createServer({
	configFile: false,
	root,
	plugins: [svelte()],
	resolve: {
		alias: {
			$lib: path.join(root, 'src/lib'),
			'$env/static/public': path.join(root, 'src/tests/stubs/env-static-public.ts')
		}
	},
	server: { host: '127.0.0.1', port: 0 }
});
await server.listen();
try {
	for (const [name, engine, touch] of [
		['webkit-touch', webkit, true],
		['chromium', chromium, false]
	]) {
		const browser = await engine.launch();
		try {
			const context = await browser.newContext({
				viewport: { width: touch ? 390 : 1280, height: 800 },
				hasTouch: touch,
				isMobile: touch
			});
			const page = await context.newPage();
			await page.route('http://api.test/tracks/tags?*', (route) =>
				route.fulfill({ json: [{ name: 'ambient', track_count: 4 }] })
			);
			await page.goto(server.resolvedUrls.local[0] + 'e2e/tag-input.html');
			const input = page.getByRole('textbox');
			await input.fill('amb');
			const suggestion = page.getByRole('button', { name: 'ambient 4 tracks' });
			if (touch) await suggestion.tap();
			else await suggestion.click();
			await page.locator('.tag-chip').waitFor();
			console.log(name, 'pointer', await page.locator('.tag-chip').allTextContents());
			assert.deepEqual(await page.locator('.tag-chip').allTextContents(), ['ambient ×']);
			await page.getByRole('button', { name: 'remove ambient' }).click();
			await input.fill('amb');
			await suggestion.waitFor();
			await input.press(touch ? 'ArrowDown' : 'Tab');
			await page.keyboard.press('Enter');
			await page.locator('.tag-chip').waitFor();
			console.log(name, 'keyboard', await page.locator('.tag-chip').allTextContents());
			assert.deepEqual(await page.locator('.tag-chip').allTextContents(), ['ambient ×']);
			await input.fill('custom tag');
			await page.getByRole('button', { name: 'save tags' }).click();
			assert.equal(await page.locator('output').textContent(), '["ambient","custom tag"]');
			console.log(name, 'outside save preserves pending custom tag');
		} finally {
			await browser.close();
		}
	}
} finally {
	await server.close();
}
