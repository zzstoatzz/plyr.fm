const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { chromium, webkit } = require(process.env.PLAYWRIGHT_MODULE || '../../../frontend/node_modules/playwright');
const { fixturePage } = require('./pds-browser-fixture.cjs');
const origin='https://next.plyr.fm';
const output=process.env.SETTINGS_SEARCH_OUTPUT||'/tmp/plyr-settings-search';
const list=data=>({object:'list',data,has_more:false});
(async()=>{
 await fs.mkdir(output,{recursive:true});
 const tracks=(await(await fetch('https://api.next.plyr.fm/v1/tracks?limit=3')).json()).data;
 const track=tracks[0];
 const engine=process.env.SETTINGS_SEARCH_BROWSER||'chromium';
 const browser=await(engine==='webkit'?webkit.launch({executablePath:process.env.WEBKIT_EXECUTABLE}):chromium.launch({channel:'chrome'}));
 try{for(const width of [390,1280])for(const theme of ['light','dark']){
  const {page,context}=await fixturePage(browser,{}, {dist:process.env.SETTINGS_SEARCH_DIST,preferences:{theme},seedPreferencesOnce:true,context:{viewport:{width,height:900},colorScheme:theme,reducedMotion:'reduce'}});
  const errors=[],queries=[];page.on('pageerror',error=>errors.push(error.message));
  let failed=false;
  const hit=(type,title,id)=>({type,title,id,record:track.record,owner:{did:track.artist.did,handle:track.artist.profile.handle,display_name:track.artist.profile.display_name||track.artist.profile.handle},image_url:track.media.artwork?.url});
  const mixed=[hit('track','A long recording title that should leave space for the type label',track.id),hit('artist','An artist with a long name',track.artist.did),hit('album','A long album name','alb_fixture'),hit('playlist','A long playlist name','pls_fixture')];
  await context.route('https://api.next.plyr.fm/**',async route=>{
   const request=route.request(),url=new URL(request.url()),path=url.pathname;
   if(request.method()!=='GET')return route.abort();
   if(process.env.SETTINGS_SEARCH_REAL_CATALOG==='true')return route.continue();
   if(path==='/v1/charts/tracks')return route.fulfill({json:list(tracks.map(track=>({track})))});
   if(path==='/v1/search'){
    const q=url.searchParams.get('q'),type=url.searchParams.get('types'),limit=Number(url.searchParams.get('limit')||20);queries.push({q,type,limit});
    if(q==='old')await new Promise(resolve=>setTimeout(resolve,900));
    if(q==='error'&&!failed){failed=true;return route.fulfill({status:503,json:{error:{message:'Search test unavailable'}}});}
    const data=q==='many'?Array.from({length:limit},(_,i)=>hit('track','Result '+i,track.id+'-'+i)):q==='none'?[]:q==='old'?[hit('track','Old result',track.id)]:type?mixed.filter(hit=>hit.type===type):mixed;
    return route.fulfill({json:list(data)}).catch(()=>{});
   }
   if(path.endsWith('/metrics'))return route.fulfill({json:{totals:{tracks:3,plays:2},top_track:null}});
   if(path.startsWith('/v1/artists/'))return route.fulfill({json:{did:track.artist.did,handle:track.artist.profile.handle,display_name:'An artist with a long name',bio:'An artist bio',avatar_url:track.artist.profile.avatar_url}});
   if(path==='/v1/tracks')return route.fulfill({json:list(tracks)});
   if(path==='/v1/albums'||path==='/v1/playlists')return route.fulfill({json:list([])});
   return route.continue();
  });
  async function shot(name){await page.screenshot({path:`${output}/${engine}-${width}-${theme}-${name}.png`,fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);}
  try{
   if(process.env.SETTINGS_SEARCH_REAL_CATALOG==='true'){
    await page.goto(origin+'/search');
    const field=page.getByRole('textbox',{name:'Search tracks, artists, albums and playlists',exact:true});await field.waitFor();
    const response=page.waitForResponse(r=>{const u=new URL(r.url());return u.pathname==='/v1/search'&&u.searchParams.get('q')==='Sounds of the Drone Mix';});
    await field.fill('Sounds of the Drone Mix');const body=await(await response).json();assert.ok(body.data.some(hit=>hit.type==='track'&&hit.title==='Sounds of the Drone Mix'));
    const result=page.getByTestId('search-results').getByRole('button',{name:/^track: Sounds of the Drone Mix,/});await result.click();
    await page.waitForFunction(()=>window.jamAudio.some(a=>!a.paused&&a.currentTime>1));await shot('real-search-playing');
    const source=await page.evaluate(()=>window.jamAudio.find(a=>!a.paused).src);
    await field.fill('zzstoatzz.io');await page.getByRole('button',{name:'artists',exact:true}).click();
    const artist=page.getByTestId('search-results').getByRole('link').first();await artist.waitFor();await artist.click();await page.waitForURL('**/u/**');
    await page.waitForFunction(src=>window.jamAudio.some(a=>!a.paused&&a.src===src),source);
    assert.deepEqual(errors,[]);console.log(`${engine}/${width}/${theme}: public Search API, actual Drone Mix playback and artist navigation passed`);continue;
   }
   await page.goto(origin+'/settings');await page.getByRole('button',{name:/^theme:/}).waitFor();
   await shot('settings');
   assert.equal(await page.getByRole('button',{name:'comic sans',exact:true}).count(),0,'Picker choices stay out of the main page');
   await page.getByRole('button',{name:/^font:/}).click();await page.getByRole('button',{name:'system',exact:true}).click();
   await page.getByRole('button',{name:'font: system',exact:true}).waitFor();
   await page.getByRole('button',{name:/^font:/}).click();await page.getByRole('button',{name:'comic sans',exact:true}).click();
   await page.getByRole('button',{name:/^interface size:/}).click();await page.getByRole('button',{name:'130%',exact:true}).click();await shot('settings-large');
   await page.getByRole('button',{name:/^interface size:/}).click();await page.getByRole('button',{name:'100%',exact:true}).click();
   await page.getByRole('button',{name:/^accent color:/}).click();await shot('accent-picker');
   await page.getByLabel('custom accent',{exact:true}).fill('#bad');assert.equal(await page.getByRole('button',{name:'apply accent',exact:true}).isDisabled(),true);
   await page.getByLabel('custom accent',{exact:true}).fill('#375bb5');await page.getByRole('button',{name:'apply accent',exact:true}).click();
   const keep=page.getByRole('switch',{name:'keep playing',exact:true});await keep.click();
   await page.reload();await page.getByRole('button',{name:'accent color: #375bb5',exact:true}).waitFor();
   assert.equal(await page.getByRole('switch',{name:'keep playing',exact:true}).isChecked(),true);
   await page.getByRole('link',{name:'Search',exact:true}).click();await page.waitForURL('**/search');
   const input=page.getByRole('textbox',{name:'Search tracks, artists, albums and playlists',exact:true});await input.waitFor();
   await page.getByRole('heading',{name:'top tracks',exact:true}).waitFor();await shot('search-browse');
   await input.fill('😀');assert.equal(queries.length,0);
   const old=page.waitForRequest(r=>new URL(r.url()).searchParams.get('q')==='old');await input.fill('old');await old;
   await input.fill('new');await page.getByTestId('search-results').getByRole('button').first().waitFor();
   await page.waitForTimeout(1000);assert.equal(await page.getByText('Old result',{exact:true}).count(),0);assert.equal(queries.filter(q=>q.q==='old').length,1,'Cancelled searches do not retry');
   await shot('search-results');
   await page.getByRole('button',{name:'artists',exact:true}).click();await page.getByTestId('search-results').getByRole('link').waitFor();
   assert.equal(await page.getByTestId('search-results').getByRole('button').count(),0);assert.equal(queries.at(-1).type,'artist');
   await page.getByRole('button',{name:'all',exact:true}).click();await page.getByTestId('search-results').getByRole('button').first().waitFor();
   await page.getByTestId('search-results').getByRole('button').first().click();await page.waitForFunction(()=>window.jamAudio.some(a=>!a.paused&&a.currentTime>0.3));
   await page.getByRole('button',{name:'Pause',exact:true}).last().waitFor();
   await page.keyboard.press('Space');await page.waitForFunction(()=>window.jamAudio.filter(a=>a.src).every(a=>a.paused));
   await page.getByRole('button',{name:'Play',exact:true}).last().waitFor();
   await page.keyboard.press('Space');await page.waitForFunction(()=>window.jamAudio.some(a=>!a.paused&&a.currentTime>0.3));
   const source=await page.evaluate(()=>window.jamAudio.find(a=>!a.paused).src);
   await page.getByTestId('search-results').getByRole('link').first().click();await page.waitForURL('**/u/**');
   await page.waitForFunction(src=>window.jamAudio.some(a=>!a.paused&&a.src===src),source);
   await page.getByRole('link',{name:'Search',exact:true}).click();await page.waitForURL('**/search');
   await input.fill('many');await page.getByRole('button',{name:'show more results',exact:true}).click();await page.getByText('Result 49',{exact:true}).waitFor();
   assert.equal(queries.at(-1).limit,50);await shot('search-expanded');
   await input.fill('none');await page.getByText('no results for “none”',{exact:true}).waitFor();await shot('search-empty');
   await input.fill('error');await page.getByText('Search test unavailable',{exact:true}).waitFor();await page.getByRole('button',{name:'Retry',exact:true}).click();
   await page.getByTestId('search-results').getByRole('button').first().waitFor();
   await page.getByRole('button',{name:'Clear search',exact:true}).click();assert.equal(await input.inputValue(),'');
   await page.getByRole('heading',{name:'top tracks',exact:true}).waitFor();assert.deepEqual(errors,[]);
   console.log(`${engine}/${width}/${theme}: settings pickers/persistence, compact rows, search cancellation/ranking/filter/limit/retry, real playback and navigation passed`);
  }catch(error){console.log(await page.locator('body').innerText());await shot('failure');throw error;}finally{await context.unrouteAll({behavior:'wait'});await context.close();}
 }}finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
