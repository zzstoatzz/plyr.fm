// Renders static/previews/atlas.jpg, the link-preview picture for /atlas: the built map, dark, at 1200x630,
// with the plyr.fm mark in the corner like the other cards. Run after `bun run build`.
// Draws from the live catalogue; ATLAS_DATA=<dir> (atlas.json, avatars/<i>.jpg, thumbs/<i>.webp) works offline.
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { setup, serve, close } = require('./fixture-catalog.cjs');

const out = path.resolve(__dirname, '../static/previews/atlas.jpg');
const local = process.env.ATLAS_DATA;

(async () => {
  const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
  const origin = await serve();
  // the canvas runs from the 216px nav to the window edge
  const { page, context } = await setup(browser, 1416, 630, { scheme: 'dark' });
  if (local) {
    const atlas = JSON.parse(fs.readFileSync(path.join(local, 'atlas.json'), 'utf8'));
    const file = new Map([
      ...atlas.artists.map((a, i) => [a.avatar, path.join(local, 'avatars', `${i}.jpg`)]),
      ...atlas.points.map((p, i) => [p.thumb, path.join(local, 'thumbs', `${i}.webp`)])
    ]);
    const serveFile = route => {
      const f = file.get(route.request().url());
      return f && fs.existsSync(f) ? route.fulfill({ body: fs.readFileSync(f) }) : route.fulfill({ status: 404 });
    };
    await page.route('https://api.next.plyr.fm/xrpc/fm.plyr.unspecced.getAtlas', route => route.fulfill({ json: atlas }));
    await page.route('https://cdn.bsky.app/**', serveFile);
    await page.route('https://images.plyr.fm/**', serveFile);
  } else {
    await page.unroute('https://api.next.plyr.fm/xrpc/fm.plyr.unspecced.getAtlas');
    await context.unroute('**/*');
  }
  // the card is the map alone: no page title or zoom controls over it
  await page.goto(`${origin}/atlas`);
  await page.addStyleTag({ content: '.atlas header, .atlas .zoom { display: none !important; }' });
  await page.getByLabel('Catalog atlas').waitFor();
  await page.waitForFunction(() => document.querySelector('.atlas header')?.clientHeight === 0);
  await page.evaluate(() => window.dispatchEvent(new Event('resize')));
  await page.waitForTimeout(2500);
  await page.mouse.move(2, 2);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const shot = await page.getByLabel('Catalog atlas').screenshot({ type: 'png' });
  const card = await page.evaluate(async ({ shot, icon }) => {
    const load = src => new Promise((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = reject; i.src = src; });
    const [map, mark] = await Promise.all([load(`data:image/png;base64,${shot}`), load(icon)]);
    const c = document.createElement('canvas');
    c.width = 1200; c.height = 630;
    const g = c.getContext('2d');
    g.drawImage(map, (1200 - map.width) / 2, (630 - map.height) / 2);
    g.globalAlpha = 0.92;
    g.drawImage(mark, 1200 - 34 - 64, 630 - 30 - 64, 64, 64);
    return c.toDataURL('image/jpeg', 0.86).split(',')[1];
  }, { shot: shot.toString('base64'), icon: `${origin}/icons/icon-512.png` });
  fs.writeFileSync(out, Buffer.from(card, 'base64'));
  console.log(`wrote ${path.relative(process.cwd(), out)}`);
  await browser.close();
  close();
})().catch(error => { console.error(error); process.exit(1); });
