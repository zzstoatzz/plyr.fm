const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { setup, tracks, serve, close } = require('./fixture-catalog.cjs');

const titles = locator => locator.evaluateAll(rows => rows.map(row => row.querySelector('.labels a')?.textContent));

async function phone(browser, origin) {
  const { context, page } = await setup(browser, 390, 844, { phone:true, scheme:'dark' });
  await page.goto(origin);
  const rows = page.getByTestId('home-track-row');
  await rows.nth(0).getByTestId('track-play-control').click();
  await rows.nth(1).getByRole('button',{name:/add .* to queue/i}).click();
  await rows.nth(2).getByRole('button',{name:/add .* to queue/i}).click();
  const toast = page.getByTestId('toast').filter({ hasText: tracks[2].metadata.title });
  await toast.getByRole('button', { name: /view queue/ }).click();
  await page.waitForURL(url => url.pathname === '/queue');
  const queued=page.locator('li.upcoming');
  await queued.nth(1).waitFor();
  assert.deepEqual(await titles(queued), [tracks[1].metadata.title, tracks[2].metadata.title]);
  // the gestures are taught once, by a hint that goes away for good after the first drag
  const hint = page.getByTestId('queue-hint');
  await hint.waitFor();
  assert.match(await hint.innerText(), /hold a track to move it, or swipe it away/);

  const first=await queued.nth(0).locator('.drag-handle').boundingBox();
  const second=await queued.nth(1).boundingBox();
  const start=[first.x+first.width/2,first.y+first.height/2];
  await page.mouse.move(...start);
  await page.mouse.down();
  await page.mouse.move(start[0],second.y+second.height*0.8,{steps:8});
  await page.mouse.up();
  await page.waitForFunction(title => document.querySelector('li.upcoming .labels a')?.textContent === title, tracks[2].metadata.title);
  await hint.waitFor({ state: 'detached' });
  assert.equal(await page.getByText('drag a track to move it').count(), 0, 'no reorder copy is left on the page once the hint is learned');

  // hold anywhere on the row, then drag it below the next one
  const touch=await context.newCDPSession(page);
  const held=await queued.nth(0).locator('.labels .subtle').boundingBox();
  const below=await queued.nth(1).boundingBox();
  const x=held.x+held.width/2, y=held.y+held.height/2;
  await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
  await page.waitForTimeout(450);
  assert.equal(await queued.nth(0).evaluate(row => row.classList.contains('lifted')), true, 'holding a row lifts it');
  for (let step = 1; step <= 8; step++) await touch.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y+(below.y+below.height*0.8-y)*step/8}]});
  await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await page.waitForFunction(title => document.querySelector('li.upcoming .labels a')?.textContent === title, tracks[1].metadata.title);

  // a quick sideways swipe still removes
  const row=await queued.nth(0).boundingBox();
  await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:row.x+180,y:row.y+2}]});
  for(const delta of [18,40,72,108]) await touch.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:row.x+180-delta,y:row.y+2}]});
  // the row follows the finger, with the red remove strip behind it
  const slid = await queued.nth(0).evaluate(node => ({ swiping: node.classList.contains('swiping'), x: new DOMMatrix(getComputedStyle(node).transform).m41, strip: getComputedStyle(node, '::after').content }));
  assert.ok(slid.swiping && slid.x < -60, `the swiped row follows the finger (${JSON.stringify(slid)})`);
  assert.equal(slid.strip, '"remove"');
  await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  // it slides out and collapses before it leaves the list
  await page.waitForFunction(()=>document.querySelector('li.upcoming.leaving'), null, { timeout: 500 });
  await page.waitForFunction(()=>document.querySelectorAll('li.upcoming').length===1);
  assert.deepEqual(await titles(queued), [tracks[2].metadata.title]);
  await context.close();
}

async function desktop(browser, origin) {
  const { context, page } = await setup(browser, 1280, 900, { scheme:'dark' });
  await page.goto(origin);
  const rows = page.getByTestId('home-track-row');
  await rows.nth(0).getByTestId('track-play-control').click();
  for (const at of [1, 2]) {
    const meta = await rows.nth(at).locator('.metrics').boundingBox();
    await page.mouse.click(meta.x + meta.width - 4, meta.y + meta.height / 2, { button: 'right' });
    const menu = page.getByRole('group', { name: `Actions for ${tracks[at].metadata.title}` });
    await menu.waitFor();
    const box = await menu.boundingBox();
    assert.ok(Math.abs(box.x - (meta.x + meta.width - 4)) < 12, 'the menu opens at the pointer');
    await menu.getByRole('button', { name: 'play next' }).click();
    await menu.waitFor({ state: 'hidden' });
  }
  await page.getByTestId('toast').filter({ hasText: `playing ${tracks[2].metadata.title} next` }).getByRole('button').click();

  // opening the menu twice in a row must not leave Escape swallowed afterwards
  const again = await rows.nth(3).locator('.metrics').boundingBox();
  for (let time = 0; time < 2; time++) await page.mouse.click(again.x + again.width - 4, again.y + again.height / 2, { button: 'right' });
  await page.keyboard.press('Escape');
  await page.getByRole('group', { name: `Actions for ${tracks[3].metadata.title}` }).waitFor({ state: 'hidden' });
  assert.equal(await page.evaluate(() => { const event = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true, bubbles: true }); document.body.dispatchEvent(event); return event.defaultPrevented; }), false, 'Escape is free once the menu is closed');
  const panel = page.getByTestId('queue-panel');
  await panel.waitFor();
  const queued = panel.locator('li.upcoming');
  await queued.nth(1).waitFor();
  assert.deepEqual(await titles(queued), [tracks[2].metadata.title, tracks[1].metadata.title], 'play next puts the newest pick first');
  const hint = panel.getByTestId('queue-hint');
  assert.match(await hint.innerText(), /^drag a track to move it/, 'a mouse gets the drag hint');
  await hint.getByRole('button', { name: 'got it' }).click();
  await hint.waitFor({ state: 'detached' });
  assert.ok(await page.evaluate(() => Object.keys(localStorage).some(key => key.startsWith('hints:seen:') && localStorage.getItem(key).includes('queue.reorder'))), 'got it is remembered on this device');

  // a press released outside the row must not leave a drag armed for the next hover and click
  const stray = await queued.nth(0).locator('.labels .subtle').boundingBox();
  await page.mouse.move(stray.x + 4, stray.y + stray.height / 2);
  await page.mouse.down();
  await page.mouse.move(stray.x - 400, stray.y + stray.height / 2, { steps: 4 });
  await page.mouse.up();
  const next = await queued.nth(1).locator('.labels .subtle').boundingBox();
  await page.mouse.move(next.x + 4, next.y + next.height / 2, { steps: 6 });
  assert.equal(await panel.locator('li.upcoming.lifted').count(), 0, 'no ghost drag after a stray press');
  await page.mouse.click(next.x + 4, next.y + next.height / 2);
  assert.deepEqual(await titles(queued), [tracks[2].metadata.title, tracks[1].metadata.title], 'a plain click does not reorder');

  const from = await queued.nth(0).locator('.labels .subtle').boundingBox();
  const to = await queued.nth(1).boundingBox();
  await page.mouse.move(from.x + 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + 2, to.y + to.height * 0.8, { steps: 10 });
  await page.mouse.up();
  await page.waitForFunction(title => document.querySelector('[data-testid=queue-panel] li.upcoming .labels a')?.textContent === title, tracks[1].metadata.title);
  await context.close();
}

(async()=>{
 const browser = await chromium.launch({args:['--autoplay-policy=no-user-gesture-required']});
 try {
  const origin = await serve();
  await phone(browser, origin);
  console.log('phone: queued toast opens the queue, handle drag, hold-and-drag and swipe removal passed');
  await desktop(browser, origin);
  console.log('desktop: right-click menu, play next, toast opens the panel, row drag passed');
 } finally {await close();await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
