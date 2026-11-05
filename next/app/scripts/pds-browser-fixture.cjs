const fs=require('node:fs/promises');
const path=require('node:path');
const pds='http://localhost:5197';
async function xrpc(method, data, token) {
 const r = await fetch(pds+'/xrpc/'+method,{method:'POST',headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},body:JSON.stringify(data)});
 const body=await r.json();
 if(!r.ok) throw Error(method+': '+(body.error||r.status)+' '+(body.message||''));
 return body;
}

async function fixtureAccounts(names) {
 const accounts={};
 for(const name of names) {
  const handle=name+'.test';
  const pass='fixture-only-password';
  let a;
  try {a=await xrpc('com.atproto.server.createAccount',{handle,email:name+'@example.test',password:pass});}
  catch(e) {console.log('Fixture create:',e.message);a=await xrpc('com.atproto.server.createSession',{identifier:handle,password:pass});}
  accounts[handle]={did:a.did,pass};
 }

 return accounts;
}
async function fixturePage(browser,accounts,options={}) {
  const context=await browser.newContext(options.context);
  if(options.dist) await context.route('https://next.plyr.fm/**',async route=>{
   const pathname=decodeURIComponent(new URL(route.request().url()).pathname);
   let file=path.join(options.dist,pathname);
   try{if(!(await fs.stat(file)).isFile()) throw Error();}catch{if(pathname.endsWith('.js')) console.log('Missing JS asset',pathname);file=path.join(options.dist,'index.html');}
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
  if(options.preferences) await context.addInitScript(prefs=>localStorage.setItem('plyr-next:prefs',JSON.stringify(prefs)),options.preferences);
  if(options.blockMetricWrites !== false) await context.route('https://api.next.plyr.fm/**', route => route.request().method()==='POST'?route.abort():route.fallback());
  await context.addInitScript(()=>{ const Original=window.Audio; window.jamAudio=[]; window.Audio=class extends Original { constructor(...args){super(...args);window.jamAudio.push(this);} }; });
  const page=await context.newPage();
  page.setDefaultTimeout(30000);
  page.on('framenavigated',frame=>{if(frame===page.mainFrame()){const u=new URL(frame.url()); console.log('nav',u.origin+u.pathname,u.hash?'fragment':'');}});
  page.on('pageerror',error=>console.log('pageerror',error.message));
  page.on('requestfailed',request=>console.log('network failure',new URL(request.url()).origin+new URL(request.url()).pathname,request.failure().errorText));


 return {page,context};
}
async function authorizeFixture(page,accounts,handle) {
  await page.getByLabel('atmosphere account').fill(handle);
  await page.getByRole('button',{name:/^(sign in|continue at .+)$/i}).last().click();
  await page.waitForURL('https://pds.fixture.test/**').catch(async error => { console.log(await page.locator('body').innerText()); throw error; });
  await page.locator('input[name=password]').fill(accounts[handle].pass);
  await page.getByRole('button',{name:/^authorize$/i}).click();

}
module.exports={fixtureAccounts,fixturePage,authorizeFixture};
