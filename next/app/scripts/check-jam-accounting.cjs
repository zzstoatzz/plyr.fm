const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createRequire } = require('node:module');
const frontend = createRequire(path.resolve(__dirname, '../../../frontend/package.json'));
const { chromium } = process.env.PLAYWRIGHT_MODULE ? require(process.env.PLAYWRIGHT_MODULE) : frontend('playwright');
const pds = 'http://localhost:5197';
const accounts = {};
const receipts=new Map();
const track=process.env.PLAYBACK_TRACK || 'trk_YXQ6Ly9kaWQ6cGxjOjZwbWJzbndlcm1haHYzcnBqaWxrcmd4by9mbS5wbHlyLnRyYWNrLzNtemNycWdoNDJxMjI';
async function xrpc(method, data, token) {
 const r = await fetch(pds+'/xrpc/'+method,{method:'POST',headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},body:JSON.stringify(data)});
 const body=await r.json();
 if(!r.ok) throw Error(method+': '+(body.error||r.status)+' '+(body.message||''));
 return body;
}
(async()=>{
 for(const name of ['jamhosthttps','jamguesthttps']) {
  const handle=name+'.test';
  const pass='fixture-only-password';
  let a;
  try {a=await xrpc('com.atproto.server.createAccount',{handle,email:name+'@example.test',password:pass});}
  catch(e) {console.log('Fixture create:',e.message);a=await xrpc('com.atproto.server.createSession',{identifier:handle,password:pass});}
  accounts[handle]={did:a.did,pass};
 }
 const browsers=await Promise.all([chromium.launch({channel:"chrome",args:["--disable-features=LocalNetworkAccessChecks"]}),chromium.launch({channel:"chrome",args:["--disable-features=LocalNetworkAccessChecks"]}),chromium.launch({channel:"chrome",args:["--disable-features=LocalNetworkAccessChecks"]})]);
 try {
 async function signIn(browser, handle, room) {
  const context=await browser.newContext();
  if(process.env.PLAYBACK_DIST) await context.route('https://next.plyr.fm/**',async route=>{
   const pathname=decodeURIComponent(new URL(route.request().url()).pathname);
   let file=path.join(process.env.PLAYBACK_DIST,pathname);
   try{if(!(await fs.stat(file)).isFile()) throw Error();}catch{if(pathname.endsWith('.js')) console.log('Missing JS asset',pathname);file=path.join(process.env.PLAYBACK_DIST,'index.html');}
   const type=file.endsWith('.js')?'text/javascript':file.endsWith('.json')?'application/json':file.endsWith('.png')?'image/png':'text/html';
   await route.fulfill({body:await fs.readFile(file),contentType:type});
  });
  await context.route('https://api.plyr.fm/**',route=>route.request().method()==='POST'?route.abort():route.continue());
  await context.route('https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle?*',async route=>{
   const h=new URL(route.request().url()).searchParams.get('handle');
   await route.fulfill({json:{did:accounts[h].did},headers:{'access-control-allow-origin':'*'}});
  });
  await context.route('https://plc.directory/**',async route=>{
   const did=decodeURIComponent(new URL(route.request().url()).pathname.slice(1));
   const response=await fetch('http://127.0.0.1:5296/'+did);
   await route.fulfill({status:response.status,json:await response.json(),headers:{'access-control-allow-origin':'*'}});
  });
  await context.route('https://pds.fixture.test/**',async route=>{
   const req=route.request();
   const url=new URL(req.url());
   const headers=await req.allHeaders();
   delete headers.host;
   headers['sec-fetch-site'] ??= url.pathname === '/oauth/authorize' && req.isNavigationRequest() ? 'cross-site' : 'same-origin';
   headers['x-forwarded-proto'] = 'https';
   delete headers['content-length'];
   const response=await fetch('http://localhost:5197'+url.pathname+url.search,{
    method:req.method(),headers,body:req.postDataBuffer() ?? undefined,redirect:'manual'
   });
   const location=response.headers.get('location');
   if(response.status>=300 && response.status<400 && location?.startsWith('https://next.plyr.fm/')) {
    const cookie=response.headers.get('set-cookie');
    await route.fulfill({status:200,contentType:'text/html',headers:cookie?{'set-cookie':cookie}:{},body:'<script>location.replace('+JSON.stringify(location)+')</script>'});
    return;
   }
   const out=Object.fromEntries(response.headers);
   delete out['content-encoding'];
   delete out['content-length'];
   await route.fulfill({status:response.status,body:Buffer.from(await response.arrayBuffer()),headers:out});
  });
  await context.addInitScript(()=>{ const Original=window.Audio; window.jamAudio=[]; window.Audio=class extends Original { constructor(...args){super(...args);window.jamAudio.push(this);} }; });
  const page=await context.newPage();
  page.setDefaultTimeout(30000);
  receipts.set(page,[]);
  page.on('response',async response=>{if(response.request().method()==='POST' && new URL(response.url()).pathname.endsWith('/plays')){
    const body=await response.json();assert.equal(response.status(),200);receipts.get(page).push(body);
  }});
  page.on('framenavigated',frame=>{if(frame===page.mainFrame()){const u=new URL(frame.url()); console.log('nav',u.origin+u.pathname,u.hash?'fragment':'');}});
  page.on('pageerror',error=>console.log('pageerror',error.message));
  page.on('requestfailed',request=>console.log('network failure',new URL(request.url()).origin+new URL(request.url()).pathname,request.failure().errorText));

  await page.goto('https://next.plyr.fm/jam/'+room);
  await page.getByRole('link',{name:'Sign in to join'}).click();
  await page.getByLabel('atmosphere account').fill(handle);
  await page.getByRole('button',{name:/^(sign in|continue at .+)$/i}).last().click();
  await page.waitForURL('https://pds.fixture.test/**').catch(async error => { console.log(await page.locator('body').innerText()); throw error; });
  await page.locator('input[name=password]').fill(accounts[handle].pass);
  await page.getByRole('button',{name:/^authorize$/i}).click();
  await page.waitForURL(url=>url.pathname.startsWith('/jam/')).catch(async e=>{console.log(await page.locator('body').innerText());throw e});
  await page.getByRole('button',{name:'Join Jam'}).waitFor();
  return page;
 }
 let room=accounts['jamhosthttps.test'].did+'~room-'+Date.now();
 const host=await signIn(browsers[0],'jamhosthttps.test',room);
 await host.getByRole('link',{name:'Home',exact:true}).click();
 await host.locator('a[href="/track/'+track+'"]').first().click();
 await host.getByRole('button',{name:'Play',exact:true}).first().click();
 await host.waitForFunction(()=>window.jamAudio.some(a=>a.currentTime>0.3));
 await host.getByRole('button',{name:'Pause',exact:true}).last().click();
 await host.getByRole('button',{name:'Open now playing',exact:true}).click();
 await host.getByRole('button',{name:'Queue',exact:true}).click();
 await host.getByRole('button',{name:'Start a Jam',exact:true}).click();
 await host.getByRole('button',{name:'Create Jam with current track'}).waitFor();
 room=decodeURIComponent(new URL(host.url()).pathname.slice('/jam/'.length));
 await host.getByRole('button',{name:'Create Jam with current track'}).click();
 await host.getByRole('button',{name:'Play Jam',exact:true}).waitFor();
 await host.getByLabel('Guest DID').fill(accounts['jamguesthttps.test'].did);
 await host.getByRole('button',{name:'Invite guest'}).click();
 await host.getByText(/Share https/).waitFor();
 const guest=await signIn(browsers[1],'jamguesthttps.test',room);
 await guest.getByRole('button',{name:'Join Jam'}).click();
 await guest.getByText('Paused',{exact:true}).waitFor();
 await host.getByRole('button',{name:'Play Jam',exact:true}).click();
 const moving=page=>page.waitForFunction(()=>window.jamAudio.some(a=>!a.paused&&a.currentTime>2));
 await Promise.all([moving(host),moving(guest)]);
 const deadline=Date.now()+20000;
 while((receipts.get(host).length<1 || receipts.get(guest).length<1) && Date.now()<deadline) await host.waitForTimeout(100);
 for(const page of [host,guest]){assert.equal(receipts.get(page).length,1);assert.equal(receipts.get(page)[0].counted,true);assert.equal(receipts.get(page)[0].sources.dedup,'postgres_durable');}
 console.log('Both independent Jam outputs earned durable Next receipts', [host, guest].map(page => ({ occurrence: receipts.get(page)[0].occurrence, count: receipts.get(page)[0].play_count }))); 
 await host.getByRole('button',{name:'Pause Jam'}).click();
 await guest.getByText('Paused',{exact:true}).waitFor();
 await guest.waitForFunction(()=>window.jamAudio.some(a=>a.paused&&a.currentTime>1));
 await host.getByRole('button',{name:'Play Jam',exact:true}).waitFor();
 await host.getByRole('button',{name:'Seek to start'}).click();
 await guest.waitForFunction(()=>window.jamAudio.some(a=>a.paused&&a.currentTime<0.6));
 await host.waitForTimeout(1500);
 assert.equal(receipts.get(host).length,1);assert.equal(receipts.get(guest).length,1);
 console.log('Independent browsers synchronized play/pause/seek; paused catch-up did not add receipts.');
 } finally {await Promise.all(browsers.map(b=>b.close()));}
})().catch(e=>{console.error(e.message);process.exitCode=1});
