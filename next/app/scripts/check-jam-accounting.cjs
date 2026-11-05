const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createRequire } = require('node:module');
const frontend = createRequire(path.resolve(__dirname, '../../../frontend/package.json'));
const { chromium } = process.env.PLAYWRIGHT_MODULE ? require(process.env.PLAYWRIGHT_MODULE) : frontend('playwright');
const { fixtureAccounts, fixturePage, authorizeFixture } = require('./pds-browser-fixture.cjs');
const receipts=new Map();
const track=process.env.PLAYBACK_TRACK || 'trk_YXQ6Ly9kaWQ6cGxjOjZwbWJzbndlcm1haHYzcnBqaWxrcmd4by9mbS5wbHlyLnRyYWNrLzNtemNycWdoNDJxMjI';
(async()=>{
 const accounts=await fixtureAccounts(['jamhosthttps','jamguesthttps']);
 const browsers=await Promise.all([chromium.launch({channel:"chrome",args:["--disable-features=LocalNetworkAccessChecks"]}),chromium.launch({channel:"chrome",args:["--disable-features=LocalNetworkAccessChecks"]}),chromium.launch({channel:"chrome",args:["--disable-features=LocalNetworkAccessChecks"]})]);
 try {
 async function signIn(browser,handle,room) {
  const {page}=await fixturePage(browser,accounts,{dist:process.env.PLAYBACK_DIST,blockMetricWrites:false});
  receipts.set(page,[]);
  page.on('response',async response=>{if(response.request().method()==='POST' && new URL(response.url()).pathname.endsWith('/plays')){
   const body=await response.json();assert.equal(response.status(),200);receipts.get(page).push(body);
  }});
  await page.goto('https://next.plyr.fm/jam/'+room);
  await page.getByRole('link',{name:'Sign in to join'}).click();
  await authorizeFixture(page,accounts,handle);
  await page.waitForURL(url=>url.pathname.startsWith('/jam/'));
  await page.getByRole('button',{name:'Join Jam'}).waitFor();
  return page;
 }
 let room=accounts['jamhosthttps.test'].did+'~room-'+Date.now();
 const host=await signIn(browsers[0],'jamhosthttps.test',room);
 await host.getByRole('link',{name:'Home',exact:true}).click();
 await host.locator('a[href="/track/'+track+'"]').first().click();
 await host.getByRole('heading',{name:'979-8-218-82066-4',exact:true}).waitFor();
 await host.getByRole('button',{name:'Play',exact:true}).last().click();
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
