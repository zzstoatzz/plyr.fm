const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const WS=require('ws');
const {execFileSync}=require('node:child_process');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'../../../frontend/node_modules/playwright');
const {fixtureAccounts,fixturePage,authorizeFixture}=require('./pds-browser-fixture.cjs');
const live=!!process.env.JAM_REALTIME_LIVE_ACCOUNTS;
const origin=live?'https://next.plyr.fm':process.env.JAM_REALTIME_ORIGIN||'http://127.0.0.1:5310';
const upstreamOrigin='https://next.plyr.fm';
const output=process.env.JAM_REALTIME_OUTPUT||'/tmp/plyr-jam-realtime';
(async()=>{
 await fs.mkdir(output,{recursive:true});
 if(live&&process.env.JAM_LIVE_FAILOVER_BARRIER)await fs.rm(process.env.JAM_LIVE_FAILOVER_BARRIER+'.ready',{force:true});
 let accounts,handles;
 if(live){
  const credentials=JSON.parse(await fs.readFile(process.env.JAM_REALTIME_LIVE_ACCOUNTS,'utf8'));
  handles=[credentials.host.handle,credentials.guest.handle];
  accounts=Object.fromEntries([credentials.host,credentials.guest].map(account=>[account.handle,{did:account.did,pass:account.password}]));
  const metadata=await(await fetch(origin+'/oauth-client-metadata.json')).json();
  assert.ok(metadata.scope.includes('rpc:fm.plyr.stg.jam.join?aud='),'Live Next metadata must contain the Jam admission scope');
 }else{accounts=await fixtureAccounts(['mvpjamhost','mvpjamguest']);handles=['mvpjamhost.test','mvpjamguest.test'];} 
 const hit=(await(await fetch('https://api.next.plyr.fm/v1/search?q=Sounds%20of%20the%20Drone%20Mix')).json()).data.find(t=>t.type==='track'&&t.title==='Sounds of the Drone Mix');
 const room=accounts[handles[0]].did+'~realtime'+Date.now().toString(36);
 const browsers=await Promise.all([0,1].map(()=>chromium.launch({channel:'chrome',args:['--disable-features=LocalNetworkAccessChecks']})));
 const clients=[];
 try{
  for(let i=0;i<2;i++){
   let fixture;
   if(live){
    const context=await browsers[i].newContext({viewport:{width:i?390:1280,height:900},colorScheme:i?'light':'dark'});
    await context.route('https://api.next.plyr.fm/**',route=>route.request().method()==='POST'?route.abort():route.fallback());
    await context.addInitScript(()=>{const Audio=window.Audio;window.jamAudio=[];window.Audio=class extends Audio{constructor(...args){super(...args);window.jamAudio.push(this)}};const Socket=window.WebSocket;window.jamSockets=[];window.WebSocket=class extends Socket{constructor(...args){super(...args);window.jamSockets.push(this)}}});
    fixture={context,page:await context.newPage()};
   }else fixture=await fixturePage(browsers[i],accounts,{dist:process.env.JAM_REALTIME_DIST,origin,onPdsResponse:(path,status)=>{if(path.includes('getServiceAuth')||path.includes('getDelegationToken'))console.log('PDS',path,status)},context:{viewport:{width:i?390:1280,height:900},colorScheme:i?'light':'dark'}});
   await fixture.context.addInitScript(()=>{
    window.jamSeeks=[];
    const descriptor=Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype,'currentTime');
    Object.defineProperty(HTMLMediaElement.prototype,'currentTime',{...descriptor,set(value){window.jamSeeks.push({target:value,at:Date.now()});descriptor.set.call(this,value);}});
   });
   let backend=Number(process.env.JAM_INSTANCE_A||5301)+(i?1:0);
   const frames=[],commands=[];let admissions=0,connections=0,currentSocket;
   if(!live) await fixture.context.route('https://plyr-jams-next.fly.dev/**',async route=>{
    const u=new URL(route.request().url());const request=route.request();
    const r=await fetch(`http://127.0.0.1:${backend}`+u.pathname+u.search,{method:request.method(),headers:{'content-type':'application/json',origin:upstreamOrigin},body:request.postDataBuffer()||undefined});
    if(u.pathname==='/v1/jams/join'&&r.ok)admissions++;
    await route.fulfill({status:r.status,headers:{...Object.fromEntries(r.headers),'access-control-allow-origin':origin},body:Buffer.from(await r.arrayBuffer())});
   });
   if(!live) await fixture.context.routeWebSocket('wss://plyr-jams-next.fly.dev/**',route=>{
    const u=new URL(route.url());const upstream=new WS(`ws://127.0.0.1:${backend}`+u.pathname+u.search,{origin:upstreamOrigin});const pending=[];currentSocket=upstream;connections++;
    upstream.on('open',()=>{for(const data of pending)upstream.send(data)});
    upstream.on('message',data=>{const text=String(data);frames.push({...JSON.parse(text),receivedAt:performance.now()});route.send(text)});
    upstream.on('close',()=>route.close());upstream.on('error',()=>route.close());
    route.onMessage(data=>{try{const m=JSON.parse(String(data));if(m.action)commands.push({...m,sentAt:performance.now()});}catch{}if(upstream.readyState===WS.OPEN)upstream.send(data);else pending.push(data)});route.onClose(()=>upstream.close());
   });
   if(live){
    fixture.page.on('response',response=>{if(new URL(response.url()).pathname==='/v1/jams/join'&&response.ok())admissions++;});
    fixture.page.on('websocket',socket=>{
     connections++;
     socket.on('framesent',frame=>{try{const m=JSON.parse(String(frame.payload));if(m.action)commands.push({...m,sentAt:performance.now()});}catch{}});
     socket.on('framereceived',frame=>{try{frames.push({...JSON.parse(String(frame.payload)),receivedAt:performance.now()});}catch{}});
    });
   }
   await fixture.page.goto(origin+'/jam/'+encodeURIComponent(room)+'?track='+encodeURIComponent(hit.id));
   await fixture.page.getByRole('link',{name:'Sign in to join',exact:true}).click();
   if(live){
    await fixture.page.getByLabel('atmosphere account').fill(handles[i]);
    await fixture.page.getByRole('button',{name:/^(sign in|continue at .+)$/i}).last().click();
    await fixture.page.locator('input[name=password]').fill(accounts[handles[i]].pass);
    await fixture.page.getByRole('button',{name:/^authorize$/i}).click();
   }else await authorizeFixture(fixture.page,accounts,handles[i]);
   await fixture.page.waitForURL(u=>u.pathname.startsWith('/jam/'));
   clients.push({...fixture,frames,commands,stats:()=>({admissions,connections}),disconnect:()=>live?fixture.page.evaluate(()=>window.jamSockets.filter(socket=>socket.url.includes('/v1/jams/socket')).at(-1)?.close()):currentSocket?.terminate(),changeBackend:port=>{backend=port}});
  }
  const [h,g]=clients;
  await h.page.getByRole('button',{name:'Create Jam with current track',exact:true}).click();
  await h.page.getByText('connected',{exact:true}).waitFor();
  await h.page.getByRole('textbox',{name:'Guest DID',exact:true}).fill(accounts[handles[1]].did);
  await h.page.getByRole('button',{name:'Invite guest',exact:true}).click();
  await g.page.getByRole('button',{name:'Join Jam',exact:true}).click();await g.page.getByText('connected',{exact:true}).waitFor();
  const media=page=>page.waitForFunction(()=>window.jamAudio.some(a=>!a.paused&&!a.seeking&&a.readyState>=2&&a.currentTime>.3),undefined,{timeout:15_000});
  const listen=async client=>{
   try{await client.page.waitForFunction(()=>window.jamAudio.some(a=>!a.paused&&!a.seeking&&a.readyState>=2&&a.currentTime>.3),undefined,{timeout:1500});return;}catch{}
   const unlock=client.page.getByRole('button',{name:'Play audio on this device',exact:true});
   if(await unlock.isVisible())try{await unlock.click({timeout:1500});}catch(error){if(!await client.page.evaluate(()=>window.jamAudio.some(a=>!a.paused&&!a.seeking&&a.readyState>=2&&a.currentTime>.3)))throw error;}
   await media(client.page);
  };
  const state=client=>client.frames.filter(f=>f.state).reduce((latest,frame)=>!latest||frame.state.epoch!==latest.epoch||frame.state.revision>=latest.revision?frame.state:latest,undefined);
  const until=async(check,label)=>{const deadline=Date.now()+10_000;while(!check()){if(Date.now()>deadline)throw Error(label);await new Promise(r=>setTimeout(r,20));}};
  const sync=async label=>{
   await Promise.all([h,g].map(c=>media(c.page)));
   const sample=async()=>{
    const pair=await Promise.all([h,g].map(c=>c.page.evaluate(()=>{const a=window.jamAudio.find(a=>!a.paused&&!a.seeking&&a.readyState>=2&&a.currentTime>0);return a?{position:a.currentTime,at:Date.now(),paused:a.paused}:null;})));
    assert.ok(pair.every(Boolean),'Both browsers are producing real audio');
    const at=Math.max(...pair.map(p=>p.at));const positions=pair.map(p=>p.position+(at-p.at)/1000);
    return Math.abs(positions[0]-positions[1])*1000;
   };
   const settleStarted=performance.now();let stable=0,initialMax=0;
   while(stable<3){const drift=await sample();initialMax=Math.max(initialMax,drift);stable=drift<350?stable+1:0;if(performance.now()-settleStarted>5_000)throw Error(label+' audio did not converge: '+drift+'ms');await new Promise(r=>setTimeout(r,50));}
   const drifts=[];for(let i=0;i<10;i++){drifts.push(await sample());await new Promise(r=>setTimeout(r,100));}
   drifts.sort((a,b)=>a-b);console.log(label,'playhead drift ms',JSON.stringify({startupMax:initialMax,convergedAfter:performance.now()-settleStarted-1000,median:drifts[4],p95:drifts[9],max:drifts[9]}));
   assert.ok(drifts[9]<500,'Playing browsers should remain within 500ms after convergence');
  };
  const started=Date.now();await h.page.getByRole('button',{name:'Play Jam',exact:true}).click();
  await g.page.getByRole('button',{name:'Pause Jam',exact:true}).waitFor();console.log(live?'Live UI play delivery ms':'Cross-instance UI play delivery ms',Date.now()-started);
  await Promise.all([h,g].map(listen));
  await sync('Initial');
  console.log('Beginning held duplicate pause');
  const pauseBoxes=await Promise.all([h,g].map(c=>c.page.getByRole('button',{name:'Pause Jam',exact:true}).boundingBox()));
  await Promise.all([h,g].map((c,i)=>c.page.mouse.move(pauseBoxes[i].x+pauseBoxes[i].width/2,pauseBoxes[i].y+pauseBoxes[i].height/2)));
  await Promise.all([h.page.mouse.down(),g.page.mouse.down()]);
  await h.page.mouse.up();
  await g.page.getByRole('button',{name:'Play Jam',exact:true}).waitFor();
  await g.page.mouse.up();
  await Promise.all([h.page.getByRole('button',{name:'Play Jam',exact:true}).waitFor(),g.page.getByRole('button',{name:'Play Jam',exact:true}).waitFor()]);
  await until(()=>state(h)?.playing===false&&state(g)?.playing===false,'Pause intents did not leave both clients paused');
  assert.equal(h.commands.at(-1).action,'pause');assert.equal(g.commands.at(-1).action,'pause');
  console.log('Held Pause remained pause across the peer broadcast');
  const canceled=await h.page.getByRole('button',{name:'Play Jam',exact:true}).boundingBox();
  await h.page.mouse.move(canceled.x+canceled.width/2,canceled.y+canceled.height/2);await h.page.mouse.down();await h.page.mouse.move(0,0);await h.page.mouse.up();await h.page.waitForTimeout(30);
  await g.page.getByRole('button',{name:'Play Jam',exact:true}).click();
  await h.page.getByRole('button',{name:'Pause Jam',exact:true}).waitFor();
  await h.page.getByRole('button',{name:'Pause Jam',exact:true}).evaluate(node=>node.click());
  await Promise.all([h.page.getByRole('button',{name:'Play Jam',exact:true}).waitFor(),g.page.getByRole('button',{name:'Play Jam',exact:true}).waitFor()]);
  assert.equal(h.commands.at(-1).action,'pause','Canceled press cannot leak old Play into accessible activation');
  await h.page.getByRole('button',{name:'Play Jam',exact:true}).press('Enter');await g.page.getByRole('button',{name:'Pause Jam',exact:true}).waitFor();
  console.log('Canceled-press accessible activation and keyboard Play passed');
  await Promise.all([h,g].map(listen));
  await h.page.getByRole('button',{name:'Open now playing',exact:true}).click();await h.page.getByRole('dialog').waitFor();
  const slider=h.page.getByRole('slider',{name:'Playback position',exact:true});await slider.focus();await slider.press('PageUp');await slider.press('PageUp');await slider.press('ArrowRight');
  await h.page.getByRole('button',{name:'Close',exact:true}).click();await h.page.getByRole('dialog').waitFor({state:'hidden'});await h.page.getByText('connected',{exact:true}).waitFor();
  await g.page.getByRole('button',{name:'Open now playing',exact:true}).click();const gs=g.page.getByRole('slider',{name:'Playback position',exact:true});await gs.waitFor();assert.equal(await gs.getAttribute('aria-disabled'),'true');await g.page.getByRole('button',{name:'Close',exact:true}).click();await g.page.getByRole('dialog').waitFor({state:'hidden'});
  await media(h.page);await media(g.page);await sync('After rapid scrubbing');
  const before=clients.map(c=>c.stats());const epoch=state(h).epoch;const revision=state(h).revision;
  for(const c of[h,g])await c.page.evaluate(()=>{window.preFailoverAudio=window.jamAudio.find(a=>!a.paused)});
  h.changeBackend(Number(process.env.JAM_INSTANCE_B||5302));
  const failoverStarted=performance.now();
  const barrier=live&&process.env.JAM_LIVE_FAILOVER_BARRIER;
  if(barrier){
   await fs.rm(barrier+'.release',{force:true});
   await fs.writeFile(barrier+'.ready',JSON.stringify({room,readyAtMs:Date.now(),clients:before})+'\n',{mode:0o600});
   console.log('Live failover barrier ready',barrier+'.ready','Stop a machine hosting these sockets, then create',barrier+'.release');
   const deadline=Date.now()+300_000;
   while(true){
    try{await fs.access(barrier+'.release');break;}catch(error){if(error.code!=='ENOENT')throw error;}
    assert.ok(Date.now()<deadline,'Timed out waiting for external live failover release');
    await new Promise(resolve=>setTimeout(resolve,200));
   }
   console.log('External live failover released after ms',performance.now()-failoverStarted);
  }else if(live)await h.disconnect();
  else if(process.env.JAM_KILL_INSTANCE_A_PID){
   const pid=Number(process.env.JAM_KILL_INSTANCE_A_PID);
   const executable=execFileSync('ps',['-p',String(pid),'-o','comm='],{encoding:'utf8'}).trim();
   const listener=execFileSync('lsof',['-a','-p',String(pid),'-iTCP:5301','-sTCP:LISTEN','-t'],{encoding:'utf8'}).trim();
   assert.ok(executable.endsWith('plyr-backend')&&listener===String(pid),'Only kill the owned fixture coordinator');
   process.kill(pid,'SIGKILL');
  }else await h.disconnect();
  const recovered=c=>c.stats().admissions>before[clients.indexOf(c)].admissions&&c.stats().connections>before[clients.indexOf(c)].connections;
  await until(()=>barrier?clients.some(recovered):recovered(h),barrier?'No browser naturally reconnected with fresh admission after external failover':'Host did not reconnect with fresh admission');
  for(const c of clients)await c.page.getByText('connected',{exact:true}).waitFor();
  if(barrier)console.log('External failover naturally reconnected client indices',clients.flatMap((c,i)=>recovered(c)?[i]:[]));
  else console.log(live?'Live reconnect fresh-admission ms':'Failover fresh-admission-to-second-instance ms',performance.now()-failoverStarted);
  for(const c of clients){assert.equal(state(c).epoch,epoch);assert.ok(state(c).revision>=revision);}
  for(const c of[h,g])assert.equal(await c.page.evaluate(()=>window.preFailoverAudio===window.jamAudio.find(a=>!a.paused)),true,'Failover does not replace the audio source');
  await sync('After coordinator failover');
  const pauseStarted=performance.now();await g.page.getByRole('button',{name:'Pause Jam',exact:true}).click();await h.page.getByRole('button',{name:'Play Jam',exact:true}).waitFor();console.log('Post-failover guest pause UI delivery ms',performance.now()-pauseStarted);
  await g.page.getByRole('button',{name:'Play Jam',exact:true}).click();
  await h.page.getByRole('button',{name:'Pause Jam',exact:true}).waitFor();
  const commandsBeforeRadio=h.commands.length;
  await h.page.getByRole('link',{name:'Home',exact:true}).first().click();
  await h.page.getByRole('link',{name:'Radio',exact:true}).click();
  await h.page.getByRole('button',{name:'listen live',exact:true}).click();
  await h.page.getByRole('button',{name:'stop listening',exact:true}).first().waitFor();
  await media(h.page);
  assert.equal(await h.page.evaluate(()=>window.preFailoverAudio.paused&&window.jamAudio.some(a=>a!==window.preFailoverAudio&&!a.paused&&!a.seeking&&a.readyState>=2&&a.currentTime>.3)),true,'Radio plays on this device after leaving the Jam');
  assert.equal(state(g).playing,true,'Leaving for radio must not pause the remaining Jam participant');
  await g.page.getByRole('button',{name:'Pause Jam',exact:true}).waitFor();
  assert.equal(h.commands.length,commandsBeforeRadio,'Switching to radio sends no shared command');
  console.log('Jam to radio preserved peer playback');
  console.log('Admission and connection counts',JSON.stringify(clients.map(c=>c.stats())));
  await h.page.screenshot({path:output+'/host.png'});await g.page.screenshot({path:output+'/guest.png'});
  console.log('Independent browser create/invite/join, explicit pause race, host scrubbing and guest seek restriction passed');
 }catch(e){for(let i=0;i<clients.length;i++){console.log('Audio elements',i,await clients[i].page.evaluate(()=>window.jamAudio.map(a=>({source:a.src?new URL(a.src).origin+new URL(a.src).pathname:'',paused:a.paused,time:a.currentTime,ready:a.readyState,network:a.networkState,error:a.error?.code}))));console.log('Audio seeks',i,await clients[i].page.evaluate(()=>window.jamSeeks));console.log('Client commands',i,clients[i].commands.map(c=>({action:c.action,revision:c.expectedRevision,id:c.id})));console.log('Client states',i,clients[i].frames.filter(f=>f.state).slice(-10).map(f=>({type:f.type,outcome:f.outcome,id:f.id,revision:f.state.revision,playing:f.state.playing})));if(!live||new URL(clients[i].page.url()).origin===origin){console.log('Client',i,await clients[i].page.locator('body').innerText());await clients[i].page.screenshot({path:output+'/failure-'+i+'.png'});}else console.log('Failure outside app origin; auth-page contents withheld');}throw e;}finally{await Promise.all(browsers.map(b=>b.close()));}
})().catch(e=>{console.error(e);process.exitCode=1});
