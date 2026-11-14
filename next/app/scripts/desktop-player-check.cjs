const assert = require('node:assert/strict');

async function runDesktop(browser, width, theme, { setup, track, screenshot }) {
 const {page,context,errors}=await setup(browser,width,theme);
 try{
  await page.getByRole('button',{name:'Play',exact:true}).last().click();
  await page.waitForFunction(()=>window.__playerPresentationMedia?.currentTime>0.3);
  await page.evaluate(()=>{window.__desktopMedia=window.__playerPresentationMedia;});
  const continuity=()=>page.waitForFunction(()=>window.__desktopMedia===window.__playerPresentationMedia&&!window.__desktopMedia.paused);
  const dock=page.getByTestId('player-dock');
  const bounds=await dock.boundingBox();
  assert.ok(bounds.x<1&&Math.abs(bounds.width-width)<2,'Desktop dock spans the viewport');
  await dock.getByRole('slider',{name:'Volume',exact:true}).focus();
  await page.keyboard.press('Home');await page.waitForFunction(()=>window.__desktopMedia.volume===0);
  await page.keyboard.press('End');await page.waitForFunction(()=>window.__desktopMedia.volume===1);
  await dock.getByRole('button',{name:'Mute',exact:true}).click();await page.waitForFunction(()=>window.__desktopMedia.volume===0);
  await dock.getByRole('button',{name:'Unmute',exact:true}).click();await page.waitForFunction(()=>window.__desktopMedia.volume===1);
  await screenshot(page,`desktop-${width}-${theme}-dock`);
  const original=page.url();
  await page.getByRole('button',{name:'Open now playing',exact:true}).click();await page.waitForURL('**/now-playing');
  const dialog=page.getByRole('dialog');await dialog.waitFor();
  const surface=await dialog.boundingBox();assert.ok(surface.width>=width-2&&surface.height>=898,'Now Playing fills the viewport');
  const art=await page.getByTestId('now-playing-artwork').boundingBox();assert.ok(art.width>=Math.min(width*.35,500),'Artwork uses desktop space');
  assert.equal(await page.getByRole('button',{name:'Pause',exact:true}).count(),1,'Only expanded transport is exposed');
  assert.equal(await page.getByTestId('desktop-now-playing').count(),0);
  await continuity();await screenshot(page,`desktop-${width}-${theme}-expanded`);
  await dialog.getByRole('slider',{name:'Playback position',exact:true}).focus();await page.keyboard.press('ArrowRight');
  await page.waitForFunction(()=>window.__desktopMedia.currentTime>=1);
  const chapters=dialog.getByTestId('now-playing-chapters');
  await chapters.getByRole('button',{name:'Jump to 1:50, chorus',exact:true}).click();await page.waitForFunction(()=>window.__desktopMedia.currentTime>=110&&window.__desktopMedia.currentTime<115);
  await dialog.getByText('now: chorus',{exact:true}).waitFor();
  assert.equal(await chapters.getByRole('button',{name:'Jump to 1:50, chorus',exact:true}).getAttribute('aria-current'),'true','The playing chapter is marked');
  await chapters.getByRole('button',{name:'Jump to 0:40, first verse',exact:true}).click();await page.waitForFunction(()=>window.__desktopMedia.currentTime>=40&&window.__desktopMedia.currentTime<45);
  await dialog.getByRole('slider',{name:'Volume',exact:true}).focus();await page.keyboard.press('Home');await page.waitForFunction(()=>window.__desktopMedia.volume===0);
  await page.keyboard.press('End');await page.waitForFunction(()=>window.__desktopMedia.volume===1);
  await dialog.getByRole('button',{name:'Pause',exact:true}).click();await page.waitForFunction(()=>window.__desktopMedia.paused);
  await dialog.getByRole('button',{name:'Play',exact:true}).click();await continuity();
  await page.keyboard.press('Escape');await page.waitForURL(original);await dialog.waitFor({state:'detached'});await continuity();
  await page.getByRole('button',{name:'Open now playing',exact:true}).waitFor();
  await page.waitForFunction(()=>document.activeElement?.getAttribute('aria-label')==='Open now playing');
  await page.getByRole('button',{name:'Open now playing',exact:true}).click();await page.waitForURL('**/now-playing');
  await page.goBack();await page.waitForURL(original);await continuity();
  await page.getByRole('button',{name:'Open now playing',exact:true}).click();await page.waitForURL('**/now-playing');
  await dialog.getByRole('button',{name:'Queue',exact:true}).click();await page.waitForURL('**/queue');await continuity();
  await dock.getByRole('button',{name:'Open now playing',exact:true}).click();await page.waitForURL('**/now-playing');
  await dialog.getByRole('link',{name:/^About /}).click();await page.waitForURL(original);await continuity();
  assert.deepEqual(errors,[]);
  console.log(`${width}/${theme}: full-width dock, full-screen artwork, single transport, volume/seek, Back/Escape/queue/detail and continuous audio passed`);
 }catch(error){await screenshot(page,`desktop-${width}-${theme}-failure`);throw error;}finally{await context.unrouteAll({behavior:'ignoreErrors'});await context.close();}
}
module.exports={runDesktop};
