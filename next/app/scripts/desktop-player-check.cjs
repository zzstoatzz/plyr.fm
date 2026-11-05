const assert = require('node:assert/strict');

async function runDesktop(browser, width, theme, { setup, track, screenshot }) {
 const {page,context,errors}=await setup(browser,width,theme);
 try{
  await page.route('https://api.next.plyr.fm/v1/search?**',r=>r.fulfill({json:{object:'list',data:[],has_more:false}}));
  await page.getByRole('button',{name:'Play',exact:true}).last().click();
  await page.waitForFunction(()=>window.__playerPresentationMedia?.currentTime>0.3);
  await page.evaluate(()=>{window.__desktopMedia=window.__playerPresentationMedia;});
  const continuity=()=>page.waitForFunction(()=>window.__desktopMedia===window.__playerPresentationMedia&&!window.__desktopMedia.paused);
  const original=page.url();
  await page.getByRole('button',{name:'Open now playing',exact:true}).click();
  const pane=page.getByTestId('desktop-now-playing');await pane.waitFor();
  assert.equal(page.url(),original,'Desktop expansion does not add a modal route');
  assert.equal(await page.getByRole('dialog').count(),0);
  assert.ok((await pane.boundingBox()).width<=340);
  const initialAccent=await pane.getByRole('button',{name:'Pause',exact:true}).locator('svg').getAttribute('stroke');
  await page.getByRole('link',{name:'Settings',exact:true}).click();await page.waitForURL('**/settings');
  await page.getByRole('button',{name:/^accent color:/}).click();await page.getByRole('button',{name:'Accent rose',exact:true}).click();
  await page.waitForFunction(color=>{const panel=document.querySelector('[data-testid=desktop-now-playing]');return panel?.querySelector('[aria-label=Pause] svg')?.getAttribute('stroke')!==color;},initialAccent);
  await continuity();
  await page.getByRole('link',{name:'Search',exact:true}).click();await page.waitForURL('**/search');
  const input=page.getByRole('textbox',{name:'Search tracks, artists, albums and playlists'});await input.fill('fixture');
  await page.getByText('no results for “fixture”',{exact:true}).waitFor();await continuity();
  await input.press('Escape');await pane.waitFor({state:'detached'});await continuity();
  assert.equal(await input.inputValue(),'fixture');
  await page.getByRole('button',{name:'Open now playing',exact:true}).click();await pane.waitFor();
  await screenshot(page,`desktop-${width}-${theme}-browse`);
  const slider=pane.getByRole('slider',{name:'Seek',exact:true});await slider.focus();await slider.press('ArrowRight');
  await page.waitForFunction(()=>window.__desktopMedia.currentTime>=1);
  await pane.getByRole('button',{name:'Pause',exact:true}).click();await page.waitForFunction(()=>window.__desktopMedia.paused);
  await pane.getByRole('button',{name:'Play',exact:true}).click();await continuity();
  await pane.getByRole('link',{name:'jack',exact:true}).click();await page.waitForURL('**/u/fixture.test');await continuity();
  await pane.waitFor();await page.goBack();await page.waitForURL('**/search');assert.equal(await input.inputValue(),'fixture');
  await pane.getByRole('button',{name:'Open queue',exact:true}).click();await page.waitForURL('**/queue');await continuity();
  await page.goBack();await page.waitForURL('**/search');await pane.waitFor();
  await page.keyboard.press('Escape');await pane.waitFor({state:'detached'});
  assert.equal(await page.evaluate(()=>document.activeElement?.getAttribute('aria-label')),'Open now playing');
  await continuity();assert.deepEqual(errors,[]);
  console.log(`${width}/${theme}: nonmodal desktop player, browsing, queue, seek, playback continuity and Escape focus passed`);
 }catch(error){await screenshot(page,`desktop-${width}-${theme}-failure`);throw error;}finally{await context.unrouteAll({behavior:'ignoreErrors'});await context.close();}
}
module.exports={runDesktop};
