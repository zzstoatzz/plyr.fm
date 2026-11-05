const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const {chromium,webkit}=require(process.env.PLAYWRIGHT_MODULE||'../../../frontend/node_modules/playwright');
const {fixturePage,fixtureAccounts,authorizeFixture}=require('./pds-browser-fixture.cjs');
const origin='https://next.plyr.fm';
const output=process.env.HOME_LAYOUT_OUTPUT||'/tmp/plyr-home-layout';
const list=(data,has_more=false,next_cursor)=>({object:'list',data,has_more,next_cursor});
(async()=>{
 await fs.mkdir(output,{recursive:true});
 const found=(await(await fetch('https://api.next.plyr.fm/v1/search?q=Sounds%20of%20the%20Drone%20Mix')).json()).data.find(h=>h.type==='track'&&h.title==='Sounds of the Drone Mix');
 const base=await(await fetch('https://api.next.plyr.fm/v1/tracks/'+found.id)).json();
 const track=i=>{const uri=`at://${base.artist.did}/${base.record.collection}/layout-${i}`;return {...base,id:'trk_'+Buffer.from(uri).toString('base64url'),record:{...base.record,uri,rkey:'layout-'+i},metadata:{...base.metadata,title:`Recording ${i}`}}};
 const engine=process.env.HOME_LAYOUT_BROWSER||'chromium';
 const browser=await(engine==='webkit'?webkit.launch({executablePath:process.env.WEBKIT_EXECUTABLE}):chromium.launch({channel:'chrome',args:['--disable-features=LocalNetworkAccessChecks']}));
 try{for(const width of [390,1280])for(const theme of ['light','dark']){
  const accounts=engine==='chromium'?await fixtureAccounts(['layout'+width+theme[0]+Date.now().toString(36).slice(-6)]):{};
  const handle=Object.keys(accounts)[0];
  const {page,context}=await fixturePage(browser,accounts,{dist:process.env.HOME_LAYOUT_DIST,preferences:{theme,accent:'#d24b79'},context:{viewport:{width,height:900},colorScheme:theme}});
  const errors=[],cursors=[];page.on('pageerror',e=>errors.push(e.message));
  let c1=0,c2=0,slow=false;
  await context.route('https://public.api.bsky.app/xrpc/app.bsky.graph.getFollows?*',r=>r.fulfill({json:{follows:Array.from({length:5},(_,i)=>({did:`did:plc:friend${i}`,avatar:null}))}}));
  await context.route('https://api.next.plyr.fm/**',async r=>{
   const u=new URL(r.request().url()),p=u.pathname;
   if(p==='/v1/artists/resolve')return r.fulfill({json:list(Array.from({length:5},(_,i)=>({did:`did:plc:friend${i}`,handle:`friend${i}.test`,display_name:`Friend ${i}`,avatar_url:null,track_count:i+1})))});
   if(r.request().method()!=='GET')return r.abort();
   if(p.endsWith('/playback'))return r.fulfill({json:{availability:{status:'available',delivery:{url:(await(await fetch('https://api.next.plyr.fm/v1/tracks/'+base.id+'/playback')).json()).availability.delivery.url}}}});
   if(p==='/v1/charts/tracks')return r.fulfill({json:{data:[0,1,2].map(i=>({track:track(i)}))}});
   if(p==='/v1/tags')return r.fulfill({json:list(['electronic','asynchronous','experimental','audiobook'].map(name=>({name,track_count:12,total_plays:20})))});
   if(p==='/v1/tracks'){
    const cursor=u.searchParams.get('cursor');cursors.push(cursor);
    if(u.searchParams.has('tag'))return r.fulfill({json:list(Array.from({length:8},(_,i)=>track(i+100)))});
    if(!cursor)return r.fulfill({json:list(Array.from({length:30},(_,i)=>track(i)),true,'c1')});
    if(cursor==='c1'){c1++;await new Promise(resolve=>setTimeout(resolve,slow?800:300));if(c1===1)return r.fulfill({status:503,json:{error:{message:'Temporary feed error'}}});return r.fulfill({json:list(Array.from({length:30},(_,i)=>track(i+29)),true,'c2')});}
    if(cursor==='c2'){c2++;return r.fulfill({json:list(Array.from({length:30},(_,i)=>track(i+58)),c2===1,c2===1?'c2':undefined)});}
   }
   return r.fulfill({json:list([])});
  });
  const loaded=n=>page.getByText(`${n} tracks loaded`,{exact:true}).waitFor({state:'attached'});
  const end=async()=>{await page.waitForFunction(()=>{const n=document.querySelector('[data-testid=home-feed]');return n&&n.scrollHeight>n.clientHeight+100;});await page.getByTestId('home-feed').evaluate(n=>{n.scrollTop=n.scrollHeight;});await page.waitForTimeout(250);await page.getByTestId('home-feed').evaluate(n=>{n.scrollTop=n.scrollHeight;});};
  const shot=async name=>{await page.screenshot({path:`${output}/${engine}-${width}-${theme}-${name}.png`});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);};
  try{
   if(handle){await page.goto(origin+'/login?deviceOnly=true&return_to=%2Fsettings');await authorizeFixture(page,accounts,handle);await page.waitForURL('**/settings');
    await page.getByRole('button',{name:'save preferences across devices',exact:true}).click();await page.getByText(/appearance and playback settings are currently saved/).waitFor();assert.equal(await page.getByText('sign in again to enable sync',{exact:true}).count(),0);await shot('preferences-help');await page.getByRole('button',{name:'Close',exact:true}).click();await page.getByRole('link',{name:'Home',exact:true}).click();
   }else await page.goto(origin);
   await loaded(30);await page.getByRole('button',{name:'Filter by electronic',exact:true}).waitFor();
   const colors=await page.getByRole('button',{name:/^Filter by /}).evaluateAll(nodes=>nodes.map(n=>getComputedStyle(n.querySelector('div[dir]')).color));assert.ok(new Set(colors).size>2);
   await shot('home');await end();await page.getByText('Temporary feed error',{exact:true}).waitFor();await end();assert.equal(c1,1,'Errors stop automatic retry loops');
   await page.getByRole('button',{name:'retry loading tracks',exact:true}).click();await loaded(59);assert.equal(c1,2);
   await end();await page.getByText('could not load more items',{exact:true}).waitFor();assert.equal(c2,1,'Repeated cursors do not flood requests');
   await page.getByRole('button',{name:'retry loading tracks',exact:true}).click();await loaded(88);await end();assert.equal(c2,2);await page.getByRole('button',{name:'all tracks loaded',exact:true}).waitFor();
   slow=true;const previous=c1;const pending=page.waitForRequest(r=>new URL(r.url()).searchParams.get('cursor')==='c1');await page.getByRole('button',{name:'Refresh tracks',exact:true}).click();await loaded(30);await end();await pending;
   await page.getByRole('button',{name:'Filter by electronic',exact:true}).click();await loaded(8);await page.waitForTimeout(850);assert.ok(c1>previous);await loaded(8);await shot('filtered');assert.deepEqual(errors,[]);
   console.log(`${engine}/${width}/${theme}: automatic cursor paging, deduplication, bounded retries, stale-filter protection, colored tags and clear preferences CTA passed`);
  }catch(e){console.log({c1,c2,cursors,metrics:await page.getByTestId('home-feed').evaluate(n=>({top:n.scrollTop,height:n.scrollHeight,viewport:n.clientHeight}))});console.log(await page.locator('body').innerText());await shot('failure');throw e;}finally{await context.unrouteAll({behavior:'wait'});await context.close();}
 }
 const short=await fixturePage(browser,{}, {dist:process.env.HOME_LAYOUT_DIST,preferences:{theme:'dark'},context:{viewport:{width:390,height:900}}});let shortReads=0;
 await short.context.route('https://api.next.plyr.fm/**',r=>{const u=new URL(r.request().url());if(r.request().method()!=='GET')return r.abort();if(u.pathname==='/v1/tracks'){shortReads++;return r.fulfill({json:list([track(shortReads*10),track(shortReads*10+1)],shortReads===1,shortReads===1?'short':undefined)});}return r.fulfill({json:list([])});});
 try{await short.page.goto(origin);await short.page.getByText('4 tracks loaded',{exact:true}).waitFor({state:'attached'});assert.equal(shortReads,2);console.log(engine+': short first page automatically fills the viewport without a scroll or duplicate request');}finally{await short.context.close();}
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
