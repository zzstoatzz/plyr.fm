const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = process.env.QUEUE_ASSET_DIR;
const localCoordinator = process.env.QUEUE_LOCAL_COORDINATOR;
const artifacts = process.env.QUEUE_ARTIFACT_DIR || '/tmp/plyr-personal-queue-browser';
async function localAssets(context) {
  if (!root) return;
  await context.route('https://next.plyr.fm/**',async route=>{
    const url=new URL(route.request().url());
    const name=decodeURIComponent(url.pathname);
    if(name.includes('..')) return route.abort();
    let file=path.join(root,name==='/'?'index.html':name);
    let data;
    try { data=await fs.readFile(file); } catch {if(name.endsWith('.js'))console.log('missing chunk',name);file=path.join(root,'index.html');data=await fs.readFile(file);}
    const ext=path.extname(file);
    await route.fulfill({status:200,body:data,contentType:({'.html':'text/html','.js':'application/javascript','.json':'application/json','.png':'image/png','.ttf':'font/ttf','.svg':'image/svg+xml','.woff2':'font/woff2'})[ext]||'application/octet-stream'});
  });
}

const assert = require('node:assert/strict');
(async()=>{
 assert.ok(process.env.QUEUE_TEST_ACCOUNTS, 'set QUEUE_TEST_ACCOUNTS to disposable account JSON');
 await fs.mkdir(artifacts, {recursive:true});
 const account=JSON.parse(await fs.readFile(process.env.QUEUE_TEST_ACCOUNTS,'utf8')).host;
 const browsers=await Promise.all([chromium.launch({channel:'chrome',headless:true,args:localCoordinator?['--disable-features=LocalNetworkAccessChecks','--allow-running-insecure-content']:[]}),chromium.launch({channel:'chrome',headless:true,args:localCoordinator?['--disable-features=LocalNetworkAccessChecks','--allow-running-insecure-content']:[]})]);
 const errors=[];
 try {
 async function signIn(browser, anonymous=false) {
  const context=await browser.newContext({viewport:{width:1280,height:900}});await localAssets(context);
  if (root) await context.route('https://pds.zat.dev/oauth/authorize**', async route => {
    const response=await route.fetch({maxRedirects:0});
    const destination=response.headers().location;
    if(destination&&new URL(destination,'https://pds.zat.dev').origin==='https://next.plyr.fm')
      await route.fulfill({status:200,contentType:'text/html',body:'<script>location.replace('+JSON.stringify(destination)+')</script>'});
    else await route.fulfill({response});
  });
  if (localCoordinator) await context.route('https://plyr-jams-next.fly.dev/v1/playback/join',async route=>{
   const response=await fetch(localCoordinator+'/v1/playback/join',{method:'POST',headers:{'content-type':'application/json',origin:'https://next.plyr.fm'},body:route.request().postData()});
   await route.fulfill({status:response.status,body:Buffer.from(await response.arrayBuffer()),headers:{'content-type':'application/json','access-control-allow-origin':'https://next.plyr.fm'}});
   console.log('personal admission',response.status);
  });
  await context.addInitScript(localCoordinator=>{
   const Audio=window.Audio;window.queueAudio=[];window.Audio=class extends Audio{constructor(...args){super(...args);window.queueAudio.push(this)}};
   const Socket=window.WebSocket;window.queueFrames=[];window.queueSockets=[];
   window.WebSocket=class extends Socket {constructor(url,protocols){const parsed=new URL(url);if(localCoordinator&&parsed.host==='plyr-jams-next.fly.dev'){const local=new URL(localCoordinator);parsed.protocol=local.protocol==='https:'?'wss:':'ws:';parsed.host=local.host;}super(parsed.toString(),protocols);window.queueSockets.push(this);this.addEventListener('message',e=>{try{const value=JSON.parse(e.data);if(value.state?.personal)window.queueFrames.push(value);}catch{}});}};
  }, localCoordinator);
  const page=await context.newPage();page.setDefaultTimeout(20000);

  page.on('pageerror',e=>{errors.push(e.message);console.log('pageerror',e.message)});
  page.on('console',e=>{if(e.text().startsWith('[playback]'))console.log(e.text())});
  let anonymousPosition;
  let anonymousKey;
  if (anonymous) {
    await page.goto('https://next.plyr.fm/track/'+found.id);
    await page.getByRole('button',{name:'Play',exact:true}).first().click();
    await page.waitForFunction(()=>window.queueAudio.some(a=>!a.paused&&a.currentTime>1));
    await page.getByRole('button',{name:'Add to queue',exact:true}).click();
    await page.getByRole('button',{name:'Add to queue',exact:true}).click();
    await page.getByRole('button',{name:'Queue',exact:true}).click();
    anonymousPosition=await page.evaluate(()=>window.queueAudio.find(a=>!a.paused).currentTime);
    anonymousKey=await page.evaluate(()=>new Promise(resolve=>{const r=indexedDB.open('plyr-next-queue',1);r.onsuccess=()=>{const q=r.result.transaction('checkpoints').objectStore('checkpoints').get('anonymous');q.onsuccess=()=>{resolve(q.result.state.entries[q.result.state.index].key);r.result.close();};};}));
    await page.getByRole('button',{name:'Start a Jam',exact:true}).click();
  } else await page.goto('https://next.plyr.fm/login?return_to=/queue');
  await page.getByRole('combobox').fill(account.handle);
  await page.getByRole('combobox').press('Enter');
  await page.waitForURL('https://pds.zat.dev/**');
  await page.locator('input[name=password]').fill(account.password);
  await page.getByRole('button',{name:/^authorize$/i}).click();
  await page.waitForURL(url=>url.hostname==='next.plyr.fm'&&url.pathname==='/queue');
  await page.waitForFunction(()=>window.queueFrames.some(f=>f.type==='state'));
  if (anonymous) {
    await page.waitForFunction(key=>window.queueFrames.at(-1)?.state.queue[window.queueFrames.at(-1).state.index]?.key===key,anonymousKey);
    await page.waitForFunction(()=>window.queueAudio.some(a=>a.src&&a.readyState>=2));
    assert.equal(await page.evaluate(()=>window.queueAudio.some(a=>!a.paused)),false);
    const position=await page.evaluate(()=>window.queueAudio.find(a=>a.src)?.currentTime);
    assert.ok(Math.abs(position-anonymousPosition)<1.5);
    assert.ok(await page.getByLabel(/Reorder /).count()>=2);
    console.log('external sign-in preserves current occurrence, picks, return page and paused position');
  }
  return page;
 }
 const found=(await(await fetch('https://api.next.plyr.fm/v1/search?q=Sounds%20of%20the%20Drone%20Mix')).json()).data.find(t=>t.type==='track'&&t.title==='Sounds of the Drone Mix');
 const a=await signIn(browsers[0]);const b=await signIn(browsers[1]);
 await a.goto('https://next.plyr.fm/track/'+found.id);
 await a.waitForFunction(()=>window.queueFrames.some(f=>f.type==='state'));
 await a.getByRole('button',{name:'Play',exact:true}).first().click();
 await a.waitForFunction(()=>window.queueAudio.some(a=>!a.paused&&a.currentTime>1));
 await b.waitForFunction(()=>window.queueFrames.at(-1)?.state.playing);
 assert.equal(await b.evaluate(()=>window.queueAudio.some(a=>!a.paused)),false);
 console.log('one output plays, passive client stays silent');
 await b.goto('https://next.plyr.fm/track/'+found.id);
 await b.waitForFunction(()=>window.queueFrames.some(f=>f.type==='state'));
 assert.equal(await b.evaluate(()=>window.queueAudio.some(a=>a.src)),false);
 const addingAt=performance.now();
 await Promise.all([a.getByRole('button',{name:'Add to queue',exact:true}).click(),b.getByRole('button',{name:'Add to queue',exact:true}).click()]);
 await b.waitForFunction(()=>window.queueFrames.at(-1)?.state.queue.length>=3);
 const state=await b.evaluate(()=>window.queueFrames.at(-1).state);
 assert.equal(new Set(state.queue.map(e=>e.key)).size,state.queue.length);
 console.log('duplicate track occurrences synchronized',state.queue.length,'in',Math.round(performance.now()-addingAt),'ms');
 await b.getByRole('button',{name:'Play',exact:true}).first().click();
 await b.waitForFunction(()=>window.queueAudio.some(a=>!a.paused&&a.currentTime>1));
 await a.waitForFunction(()=>window.queueAudio.every(a=>a.paused));
 console.log('explicit play hands off output');
 await b.getByRole('button',{name:'Pause',exact:true}).first().click();
 await b.waitForFunction(()=>window.queueAudio.every(a=>a.paused));
 await b.reload();
 await b.waitForFunction(()=>window.queueFrames.some(f=>f.type==='state'));
 assert.equal(await b.evaluate(()=>window.queueAudio.some(a=>!a.paused)),false);
 await b.getByRole('button',{name:'Queue',exact:true}).click();
 await b.screenshot({path:path.join(artifacts,'signed-queue.png')});

 console.log('refresh stays paused');
 await b.getByRole('button',{name:'Play',exact:true}).first().click();
 await b.waitForFunction(()=>window.queueAudio.some(a=>!a.paused&&a.currentTime>1));
 const beforeReconnect=await b.evaluate(()=>window.queueAudio.find(a=>!a.paused).currentTime);
 await b.evaluate(()=>window.queueSockets.at(-1).close());
 await b.waitForFunction(()=>window.queueSockets.length>1&&window.queueSockets.at(-1).readyState===1);
 await b.waitForTimeout(500);
 const afterReconnect=await b.evaluate(()=>window.queueAudio.find(a=>!a.paused)?.currentTime);
 assert.ok(afterReconnect>=beforeReconnect-0.1,'reconnect must preserve audible progress');
 console.log('reconnect keeps audible position');
 const count=await b.evaluate(()=>window.queueFrames.at(-1).state.queue.length);
 await a.evaluate(()=>{window.queueSockets.at(-1).onmessage=null;});
 await a.getByRole('button',{name:'Add to queue',exact:true}).click();
 await b.waitForFunction(count=>window.queueFrames.at(-1).state.queue.length===count+1,count);
 await a.reload();
 await a.waitForFunction(()=>window.queueFrames.some(f=>f.type==='state'));
 await a.waitForFunction(owner=>new Promise(resolve=>{const r=indexedDB.open('plyr-next-queue',1);r.onsuccess=()=>{const q=r.result.transaction('checkpoints').objectStore('checkpoints').get(owner+':mutations');q.onsuccess=()=>{resolve(q.result?.entries?.length===0);r.result.close();};};}),account.did);
 assert.equal(await a.evaluate(()=>window.queueFrames.at(-1).state.queue.length),count+1);
 assert.equal(await b.evaluate(()=>window.queueAudio.some(a=>!a.paused)),true);
 console.log('lost acknowledgement survives reload without duplicating a pick or stealing output');
 await a.getByRole('button',{name:'Queue',exact:true}).click();
 const before=await b.evaluate(()=>window.queueFrames.at(-1).state.queue.map(t=>t.key));
 const handles=a.getByLabel(/Reorder /);
 const first=await handles.nth(0).boundingBox();const second=await handles.nth(1).boundingBox();
 assert.ok(first&&second);
 await a.mouse.move(first.x+first.width/2,first.y+first.height/2);await a.mouse.down();
 await a.mouse.move(second.x+second.width/2,second.y+second.height/2+8,{steps:10});await a.mouse.up();
 await b.waitForFunction(key=>window.queueFrames.at(-1).state.queue[2]?.key===key,before[1]);
 console.log('pointer drag reorders stable occurrences across devices');
 await a.getByRole('link',{name:'Home',exact:true}).click();
 assert.equal(await b.evaluate(()=>window.queueAudio.some(a=>!a.paused)),true);
 await a.getByRole('button',{name:'Queue',exact:true}).click();
 await a.getByRole('button',{name:'Play',exact:true}).first().click();
 await a.waitForFunction(()=>window.queueAudio.some(a=>!a.paused));
 await b.waitForFunction(()=>window.queueAudio.every(a=>a.paused));
 const slider=a.getByRole('slider',{name:'Playback position',exact:true});
 await slider.focus();await slider.press('Home');await slider.press('ArrowRight');
 await a.waitForFunction(()=>window.queueAudio.some(a=>!a.paused&&a.currentTime<5));
 const moving=await a.evaluate(()=>window.queueAudio.find(a=>!a.paused).currentTime);
 await a.getByRole('link',{name:'Home',exact:true}).click();await a.waitForTimeout(400);
 assert.ok(await a.evaluate(()=>window.queueAudio.find(a=>!a.paused)?.currentTime)>moving);
 console.log('scrub and SPA navigation preserve playback');
 await a.setViewportSize({width:390,height:844});
 await a.getByRole('button',{name:'Open now playing',exact:true}).click();
 await a.waitForURL(url=>url.pathname==='/now-playing');
 await a.getByRole('heading',{name:'Now playing',exact:true}).waitFor();
 await a.waitForTimeout(350);
 await a.screenshot({path:path.join(artifacts,'phone-now-playing.png')});
 await a.emulateMedia({colorScheme:'dark'});
 await a.waitForTimeout(350);
 await a.screenshot({path:path.join(artifacts,'phone-now-playing-dark.png')});
 await signIn(browsers[0],true);
 console.log('browser errors',errors);
 assert.deepEqual(errors,[]);
 } catch(e) {console.error(e.message);throw e;} finally {await Promise.all(browsers.map(b=>b.close()));}
})().catch(e=>{console.error(e.message);process.exitCode=1});
