const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '../../../frontend/node_modules/playwright');
const { fixtureAccounts, fixturePage, authorizeFixture } = require('./pds-browser-fixture.cjs');
const origin = 'https://next.plyr.fm';
const output = process.env.HOME_LISTEN_OUTPUT || '/tmp/plyr-home-listening';
(async () => {
 await fs.mkdir(output,{recursive:true});
 const real = await (await fetch('https://api.next.plyr.fm/v1/tracks?limit=3')).json();
 const tracks = real.data;
 const browser=await chromium.launch({channel:'chrome',args:['--disable-features=LocalNetworkAccessChecks']});
 try {for(const width of [390,1280])for(const theme of ['light','dark']) {
  const name='row'+width+theme[0]+Date.now().toString(36);
  const accounts=await fixtureAccounts([name]);const handle=name+'.test';
  const {page,context}=await fixturePage(browser,accounts,{dist:process.env.HOME_LISTEN_DIST,preferences:{theme,playThrough:true,keepPlaying:false},context:{viewport:{width,height:900},colorScheme:theme}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await context.route('https://public.api.bsky.app/xrpc/app.bsky.graph.getFollows?*',r=>r.fulfill({json:{follows:[]}}));
  await context.route('https://api.next.plyr.fm/**',r=>{
   const p=new URL(r.request().url()).pathname;
   if(r.request().method()!=='GET')return r.abort();
   if(p==='/v1/tracks')return r.fulfill({json:{object:'list',data:tracks,has_more:false}});
   if(p==='/v1/charts/tracks'||p==='/v1/tags')return r.fulfill({json:{object:'list',data:[],has_more:false}});
   return r.continue();
  });
  try{
   await page.goto(origin);
   const rows=page.getByTestId('home-track-row');await rows.first().waitFor();
   await rows.first().getByRole('link',{name:/sign in to like/}).click();
   await page.waitForURL(url=>url.pathname==='/login');
   assert.equal(new URL(page.url()).searchParams.get('return_to'),'/');
   await authorizeFixture(page,accounts,handle);await page.waitForURL(origin+'/');
   await rows.first().getByRole('button',{name:'Like '+tracks[0].metadata.title,exact:true}).click();
   await rows.first().getByRole('button',{name:'Unlike '+tracks[0].metadata.title,exact:true}).waitFor();
   await page.screenshot({path:`${output}/${width}-${theme}-home.png`});
   await rows.first().getByRole('link',{name:'Track details: '+tracks[0].metadata.title,exact:true}).click();
   await page.getByRole('button',{name:'Unlike',exact:true}).click();
   await page.getByRole('button',{name:'Like',exact:true}).waitFor();
   await page.getByRole('button',{name:'Back',exact:true}).click();
   await rows.first().getByRole('button',{name:'Like '+tracks[0].metadata.title,exact:true}).waitFor();
   const play=rows.first().getByRole('button',{name:'Play '+tracks[0].metadata.title,exact:true});
   assert.equal(await play.locator('svg').count(),0,'Row playback has no separate play glyph');
   const box=await rows.first().boundingBox();
   await rows.first().click({position:{x:Math.min(100,box.width/2),y:box.height-4}});
   await page.waitForFunction(()=>window.jamAudio.some(a=>!a.paused&&a.currentTime>0.3));
   const before=await page.evaluate(()=>window.jamAudio.filter(a=>!a.paused).map(a=>a.src));
   await rows.nth(1).getByRole('button',{name:'Add '+tracks[1].metadata.title+' to queue',exact:true}).click();
   assert.deepEqual(await page.evaluate(()=>window.jamAudio.filter(a=>!a.paused).map(a=>a.src)),before);
   await page.getByRole('button',{name:'Open now playing',exact:true}).click();
   await page.getByRole('button',{name:'Queue',exact:true}).click();
   await page.waitForURL(origin+'/queue');
   await page.getByLabel('Reorder '+tracks[1].metadata.title,{exact:true}).first().waitFor();
   assert.equal(await page.getByLabel('Reorder '+tracks[1].metadata.title,{exact:true}).count(),2,'Enqueue appends without changing playback');
   assert.deepEqual(errors,[]);console.log(`${width}/${theme}: real PDS like/unlike, shared state, body play, enqueue and navigation passed`);
  }finally{await context.close();}
 }}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
