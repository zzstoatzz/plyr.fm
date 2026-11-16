const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { setup, tracks, serve, close } = require('./fixture-catalog.cjs');

(async()=>{
 const browser = await chromium.launch({args:['--autoplay-policy=no-user-gesture-required']});
 try {
  const origin = await serve();
  const { context, page } = await setup(browser, 390, 844, { phone:true, scheme:'dark' });
  await page.goto(origin);
  const rows = page.getByTestId('home-track-row');
  await rows.nth(0).getByTestId('track-play-control').click();
  await rows.nth(1).getByRole('button',{name:/add .* to queue|add to queue/i}).click();
  await rows.nth(2).getByRole('button',{name:/add .* to queue|add to queue/i}).click();
  const dock=page.getByTestId('player-dock');
  await dock.getByRole('button',{name:'Queue',exact:true}).tap();
  const queued=page.locator('li.upcoming');
  await queued.nth(1).waitFor();
  const first=await queued.nth(0).locator('.drag-handle').boundingBox();
  const second=await queued.nth(1).boundingBox();
  const start=[first.x+first.width/2,first.y+first.height/2];
  const target=[start[0],second.y+second.height/2];
  await page.mouse.move(...start);
  await page.mouse.down();
  await page.mouse.move(...target,{steps:8});
  await page.mouse.up();
  assert.equal(await queued.nth(0).getByRole('link').innerText(),tracks[2].metadata.title);
  const touch=await context.newCDPSession(page);
  const row=await queued.nth(0).boundingBox();
  const y=row.y+2;
  await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:row.x+180,y}]});
  for(const delta of [18,40,72,108]) {
   await touch.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:row.x+180-delta,y}]});
  }
  await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await page.waitForFunction(()=>document.querySelectorAll('li.upcoming').length===1);
  assert.equal(await queued.nth(0).getByRole('link').innerText(),tracks[1].metadata.title);
  assert.equal(new URL(page.url()).pathname, '/queue');
  await context.close();
  console.log('phone dock, queue drag reorder and touch swipe removal passed');
 } finally {await close();await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
