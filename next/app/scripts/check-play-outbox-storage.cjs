const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const { createRequire } = require('node:module');
const os = require('node:os');
const path = require('node:path');

const requireFrontend = createRequire(path.resolve(__dirname, '../../../frontend/package.json'));
const playwright = process.env.PLAYWRIGHT_MODULE ? require(process.env.PLAYWRIGHT_MODULE) : requireFrontend('playwright');
const browserName = process.env.PLAYBACK_BROWSER || 'chromium';
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'plyr-play-outbox-'));
const bundle = path.join(temporary, 'storage.js');
execFileSync('bun', ['build', path.resolve(__dirname, '../src/play-outbox-storage.web.ts'), '--target=browser', '--format=esm', `--outfile=${bundle}`]);
const source = fs.readFileSync(bundle);

async function run() {
	const server = http.createServer((request, response) => {
		response.setHeader('Content-Type', request.url === '/storage.js' ? 'text/javascript' : 'text/html');
		response.end(request.url === '/storage.js' ? source : '<title>Play outbox persistence</title>');
	});
	await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
	const origin = `http://127.0.0.1:${server.address().port}`;
	let browser;
	try {
		browser = await playwright[browserName].launch({
			headless: true,
			...(process.env.PLAYBACK_EXECUTABLE ? { executablePath: process.env.PLAYBACK_EXECUTABLE } : browserName === 'chromium' ? { channel: 'chrome' } : {})
		});
		const context = await browser.newContext();
		const first = await context.newPage();
		const second = await context.newPage();
		async function open(page) {
			await page.goto(origin);
			await page.evaluate(async () => { globalThis.playStorage = (await import('/storage.js')).playOutboxStorage; });
		}
		await Promise.all([open(first), open(second)]);
		async function put(page, start, end) {
			await page.evaluate(async ({ start, end }) => {
				for (let number = start; number <= end; number++) {
					await playStorage.put({
						trackId: 'trk_record',
						occurrenceId: `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`,
						createdAt: number
					});
				}
			}, { start, end });
		}
		await Promise.all([put(first, 1, 35), put(second, 36, 70)]);
		const loaded = await first.evaluate(() => playStorage.load());
		assert.equal(loaded.length, 64);
		assert.deepEqual(loaded.map(item => item.createdAt).sort((a, b) => a - b), Array.from({ length: 64 }, (_, index) => index + 7));
		await second.evaluate(() => playStorage.delete('00000000-0000-4000-8000-000000000040'));
		await open(first);
		const resumed = await first.evaluate(() => playStorage.load());
		assert.equal(resumed.length, 63);
		assert.ok(!resumed.some(item => item.createdAt === 40));
		console.log(`${browserName}: IndexedDB concurrent writes, cap64, deletion and reload persistence passed`);
	} finally {
		await browser?.close();
		await new Promise(resolve => server.close(resolve));
		fs.rmSync(temporary, { recursive: true, force: true });
	}
}

run().catch(error => { console.error(error); process.exitCode = 1; });
