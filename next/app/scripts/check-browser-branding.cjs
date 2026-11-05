const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { chromium, webkit } = require(process.env.PLAYWRIGHT_MODULE || '../../../frontend/node_modules/playwright');
const origin = 'https://next.plyr.fm';
(async () => {
 const artist=await (await fetch('https://api.next.plyr.fm/v1/artists/zzstoatzz.io')).json();
 assert.ok(artist.avatar_url);
 assert.ok(artist.sources.avatar);
 for(const file of ['favicon.ico','apple-touch-icon.png']) {
  const response=await fetch(origin+'/'+file);assert.equal(response.status,200);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()),await fs.readFile(new URL('../public/'+file,'file://'+__filename)));
 }
 for(const engine of (process.env.BRANDING_BROWSER?[process.env.BRANDING_BROWSER]:['chromium','webkit'])) {
  const browser=await (engine==='webkit'?webkit.launch({executablePath:process.env.WEBKIT_EXECUTABLE}):chromium.launch({channel:'chrome'}));
  try {for(const width of (process.env.BRANDING_WIDTH?[Number(process.env.BRANDING_WIDTH)]:[390,1280]))for(const theme of (process.env.BRANDING_THEME?[process.env.BRANDING_THEME]:['light','dark'])) {
   const context=await browser.newContext({viewport:{width,height:900},colorScheme:theme});
   await context.addInitScript(theme=>localStorage.setItem('plyr-next:prefs',JSON.stringify({theme})),theme);
   const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
   try {
    const chart=page.waitForResponse(response=>new URL(response.url()).pathname==='/v1/charts/tracks');
    await page.goto(origin);await (await chart).finished();await page.getByRole('button',{name:'Refresh tracks',exact:true}).waitFor();
    assert.equal(await page.locator('link[rel=icon]').getAttribute('href'),'/favicon.ico');
    if(width===1280) {assert.equal(await page.getByRole('heading',{name:'Home',exact:true}).count(),0);await page.getByRole('link',{name:'plyr.fm home',exact:true}).waitFor();}
    await page.goto(origin+'/u/zzstoatzz.io');await page.getByRole('button',{name:'Share',exact:true}).waitFor();
    await page.waitForFunction(src=>[...document.images].some(image=>image.src===src&&image.naturalWidth>0),artist.avatar_url);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
    assert.deepEqual(errors,[]);console.log(`${engine}/${width}/${theme}: public icons, navigation, artist avatar and share icon passed`);
   } catch(error) {console.log({errors,body:await page.locator('body').innerText()});await page.screenshot({path:'/tmp/plyr-branding-failure.png'});throw error;} finally {await context.close();}
  }}finally{await browser.close();}
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
