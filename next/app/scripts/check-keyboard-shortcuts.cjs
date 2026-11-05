const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '../../../frontend/node_modules/playwright');
const { fixturePage } = require('./pds-browser-fixture.cjs');
const origin = 'https://next.plyr.fm';
(async () => {
 const tracks=(await (await fetch('https://api.next.plyr.fm/v1/tracks?limit=3')).json()).data;
 const browser=await chromium.launch({channel:'chrome',args:['--disable-features=LocalNetworkAccessChecks']});
 try { for(const width of [390,1280]) {
  const {page,context}=await fixturePage(browser,{}, {dist:process.env.KEYBOARD_DIST,preferences:{theme:'dark',playThrough:true,volume:0.6},context:{viewport:{width,height:900}}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await context.route('https://api.next.plyr.fm/**',r=>{
   if(r.request().method()!=='GET')return r.abort();
   const path=new URL(r.request().url()).pathname;
   if(path==='/v1/tracks')return r.fulfill({json:{object:'list',data:tracks,has_more:false}});
   if(path==='/v1/charts/tracks'||path==='/v1/tags')return r.fulfill({json:{object:'list',data:[],has_more:false}});
   return r.continue();
  });
  const key=async value=>{console.log('key',value);await page.evaluate(()=>document.activeElement?.blur());await page.keyboard.press(value);};
  const playing=async()=>{await page.waitForFunction(()=>window.jamAudio.some(a=>!a.paused&&a.currentTime>0.3));await page.getByRole('button',{name:'Pause',exact:true}).last().waitFor();};
  const paused=async()=>{await page.waitForFunction(()=>window.jamAudio.filter(a=>a.src).every(a=>a.paused));await page.getByRole('button',{name:'Play',exact:true}).last().waitFor();};
  try {
   await page.goto(origin);await page.locator('[data-testid=home-track-row]:visible').first().waitFor();
   await key(width===1280?'Meta+k':'Control+k');await page.waitForURL('**/search?*');
   await page.waitForFunction(()=>document.activeElement?.tagName==='INPUT');
   await page.keyboard.type('q j l m ');assert.equal(new URL(page.url()).pathname,'/search');
   await key(width===1280?'Meta+,':'Control+,');await page.waitForURL('**/settings');
   await key('q');await page.waitForURL('**/queue');
   await key('q');await page.waitForURL('**/settings');
   await page.getByRole('link',{name:'Home',exact:true}).click();
   await page.waitForURL(origin+'/');
   const row=page.locator('[data-testid=home-track-row]:visible').first();await row.waitFor();const box=await row.boundingBox();
   await row.click({position:{x:100,y:box.height-4}});await playing();
   await page.keyboard.press('Space');await paused();await page.keyboard.press('Space');await playing();
   await page.locator('[data-testid=home-track-row]:visible').first().getByRole('button',{name:'More options for '+tracks[0].metadata.title,exact:true}).click();
   await page.getByRole('dialog').waitFor();await key('q');assert.equal(new URL(page.url()).pathname,'/');
   await key('Space');await playing();await page.getByRole('button',{name:'Close',exact:true}).click();
   await key('Space');await paused();await key('Space');await playing();
   await key('ArrowRight');await page.waitForFunction(()=>window.jamAudio.some(a=>!a.paused&&a.currentTime>9));
   await key('ArrowLeft');await page.waitForFunction(()=>window.jamAudio.some(a=>!a.paused&&a.currentTime<5));
   await key('m');await page.waitForFunction(()=>window.jamAudio.filter(a=>a.src).every(a=>a.volume===0));
   await key('m');await page.waitForFunction(()=>window.jamAudio.some(a=>!a.paused&&Math.abs(a.volume-0.6)<0.01));
   const first=await page.evaluate(()=>window.jamAudio.find(a=>!a.paused).src);
   await key('l');await page.waitForFunction(src=>window.jamAudio.some(a=>!a.paused&&a.src!==src&&a.currentTime>0.3),first);
   await key('j');await page.waitForFunction(src=>window.jamAudio.some(a=>!a.paused&&a.src===src),first);
   await key('q');await page.waitForURL('**/queue');await playing();
   await key('q');await page.waitForURL(origin+'/');await playing();
   await page.getByRole('button',{name:'Open now playing',exact:true}).click();if(width>=800)await page.getByTestId('desktop-now-playing').waitFor();else await page.waitForURL('**/now-playing');
   await key('Space');await paused();await key('Space');await playing();
   await key('q');await page.waitForURL('**/queue');assert.equal(await page.getByRole('dialog').count(),0);
   await page.getByRole('link',{name:'Home',exact:true}).click();await page.waitForURL(origin+'/');
   await page.getByRole('link',{name:'Radio',exact:true}).click();await page.waitForURL('**/radio');
   await page.getByRole('button',{name:'Listen live',exact:true}).click();
   await page.waitForFunction(()=>window.jamAudio.some(a=>!a.paused&&a.src.includes('radio.plyr.fm')));
   await key('Space');await page.waitForFunction(()=>window.jamAudio.filter(a=>a.src).every(a=>a.paused));
   await page.getByRole('button',{name:'Listen live',exact:true}).last().waitFor();
   await key('Space');await page.waitForFunction(()=>window.jamAudio.some(a=>!a.paused&&a.src.includes('radio.plyr.fm')));
   assert.deepEqual(errors,[]);console.log(`${width}: every documented shortcut, editor guard, queue roundtrip, now-playing, radio handoff/pause/resume and playback continuity passed`);
  } catch(error) { console.log(await page.evaluate(()=>({path:location.pathname,active:document.activeElement?.tagName,dialogs:[...document.querySelectorAll('[role=dialog]')].map(e=>e.outerHTML.slice(0,600)),media:window.jamAudio.map(a=>({paused:a.paused,time:a.currentTime,src:a.src})),body:document.body.innerText.slice(-1000)})));await page.screenshot({path:'/tmp/plyr-keyboard-failure.png'});throw error;} finally {await context.close();}
 }} finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
