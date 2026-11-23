const assert = require('node:assert/strict');
const { once } = require('node:events');
const { mkdir } = require('node:fs/promises');
const path = require('node:path');
const { tracks } = require('./fixture-catalog.cjs');
const { method, names, trackIdFromUri } = require('./xrpc-fixture.cjs');

module.exports = async function restoredListening({ page, context, origin, coordinatorEvents, track, did }) {
  const otherDid = 'did:plc:otherartist';
  const uri = `at://${otherDid}/fm.plyr.track/latest`;
  const other = { ...tracks[1], id: 'trk_' + Buffer.from(uri).toString('base64url'),
    record: { ...track.record, uri, rkey: 'latest' },
    metadata: { ...tracks[1].metadata, title: 'new from another artist', created_at: '2026-11-16T00:00:00Z' },
    artist: { did: otherDid, profile: { ...tracks[1].artist.profile, display_name: 'another artist', handle: 'another.test' } }
  };
  const catalog = [track, other];
  await context.route('https://public.api.bsky.app/xrpc/app.bsky.graph.getFollows?**', route => route.fulfill({ json: {
    follows: catalog.map(item => ({ did: item.artist.did, avatar: item.artist.profile.avatar_url }))
  } }));
  await context.route('https://api.plyr.fm/stats/atlas', route => route.fulfill({ json: {
    points: [], artists: [], clusters: { coarse: [], fine: [] }, meta: { nTracks: 0 }
  } }));
  await page.route('https://api.next.plyr.fm/**', route => {
    const url = new URL(route.request().url());
    if (method(url) === 'resolveLatestTracks') {
      const dids = route.request().postDataJSON().dids;
      return route.fulfill({ json: { object: 'list', data: catalog.filter(item => dids.includes(item.artist.did)) } });
    }
    if (method(url) === 'resolveTracks') {
      const ids = route.request().postDataJSON().uris.map(trackIdFromUri);
      return route.fulfill({ json: { object: 'list', data: catalog.filter(item => ids.includes(item.id)), missing: [] } });
    }
    if (method(url) === 'listTracks') return route.fulfill({ json: {
      object: 'list', data: catalog.filter(item => !url.searchParams.has('artistDid') || item.artist.did === url.searchParams.get('artistDid')), has_more: false
    } });
    const found = method(url) === 'getTrack' ? catalog.find(item => names(url, item.id)) : undefined;
    if (found) return route.fulfill({ json: found });
    if (method(url) === 'getTrackComments') return route.fulfill({ json: { object: 'list', data: [], has_more: false, comments_enabled: true } });
    if (method(url) === 'getTrackLikes') return route.fulfill({ json: { object: 'list', data: [], has_more: false } });
    return route.fallback();
  });
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'home', exact: true }).click();
  const shelf = page.getByRole('region', { name: 'New from people you know' });
  await shelf.getByRole('link', { name: other.metadata.title, exact: true }).waitFor();
  assert.equal(await shelf.getByRole('article').count(), 2, 'one release is shown per followed artist');
  if (process.env.SCREENS_OUTPUT) {
    await mkdir(process.env.SCREENS_OUTPUT, { recursive: true });
    for (const width of [1440, 390]) for (const theme of ['light', 'dark']) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
      await page.screenshot({ path: path.join(process.env.SCREENS_OUTPUT, `${width}-${theme}-following.png`) });
    }
    await page.setViewportSize({ width: 1280, height: 900 });
  }
  const contextCommand = once(coordinatorEvents, 'playContext', { signal: AbortSignal.timeout(10_000) });
  await shelf.getByRole('button', { name: 'play one from each' }).click();
  const [command] = await contextCommand;
  assert.deepEqual(command.queue.map(item => item.id).sort(), [other.id, track.id].sort(), 'the real playback owner receives one track per followed artist, shuffled');
  const row = page.locator(`[data-testid="home-track-row"][data-track-id="${track.id}"]`);
  const like = row.getByRole('button', { name: 'Like ' + track.metadata.title, exact: true });
  await like.waitFor();
  const liked = page.waitForResponse(response => response.url().endsWith('/com.atproto.repo.createRecord') && response.request().postDataJSON()?.collection === 'fm.plyr.like' && response.ok());
  await like.click();
  await liked;
  await row.getByRole('button', { name: `${track.metrics.like_count + 1} likes on ${track.metadata.title}` }).waitFor();
  await row.getByRole('button', { name: 'Play ' + track.metadata.title, exact: true }).click();
  const dock = page.getByTestId('player-dock');
  await dock.getByText(track.metadata.title, { exact: true }).waitFor();
  await dock.getByRole('button', { name: 'Open now playing' }).click();
  const now = page.getByRole('dialog', { name: 'Now playing' });
  await now.getByTestId('now-playing-facts').getByRole('button', { name: `${track.metrics.like_count + 1} likes on ${track.metadata.title}` }).waitFor();
  const draft = now.getByRole('textbox', { name: 'add a comment' });
  await draft.fill('a comment from the full-screen player');
  const timestamp = await now.getByRole('button', { name: /^at \d/ }).textContent();
  await page.waitForFunction(() => document.querySelector('[data-testid="player-dock"] input[aria-label="Playback position"]')?.valueAsNumber > 0);
  assert.equal(await now.getByRole('button', { name: /^at \d/ }).textContent(), timestamp, 'typing pins the comment while playback continues');
  await now.getByRole('button', { name: 'Post comment', exact: true }).click();
  await now.getByTestId('comments-toggle').filter({ hasText: '1' }).waitFor();
  const records = await fetch('http://127.0.0.1:5197/xrpc/com.atproto.repo.listRecords?' + new URLSearchParams({ repo: did, collection: 'fm.plyr.comment' })).then(response => response.json());
  assert.equal(records.records.length, 1);
  assert.equal(records.records[0].value.text, 'a comment from the full-screen player');
  assert.deepEqual(records.records[0].value.subject, { uri: track.record.uri, cid: track.record.cid });
  await now.getByTestId('comments-toggle').click();
  await now.getByTestId('comments-view').getByText('a comment from the full-screen player', { exact: true }).waitFor();
  await now.getByTestId('comments-view').getByRole('button', { name: 'Show the cover', exact: true }).click();
  await now.getByRole('button', { name: 'Unlike track', exact: true }).click();
  await now.getByTestId('now-playing-facts').getByRole('button', { name: `${track.metrics.like_count} likes on ${track.metadata.title}` }).waitFor();
  await page.keyboard.press('Escape');
  await now.waitFor({ state: 'hidden' });
  await row.getByRole('link', { name: track.metadata.title, exact: true }).click();
  const comments = page.getByRole('region', { name: 'comments', exact: true });
  await comments.getByRole('button', { name: 'Delete comment', exact: true }).click();
  await comments.getByRole('button', { name: 'delete', exact: true }).click();
  await comments.getByText('no comments yet.').waitFor();
  // a return visit draws the last shelf while the follow graph is still loading
  let release;
  const held = new Promise(resolve => { release = resolve; });
  const hold = async route => { await held; await route.fallback(); };
  const follows = 'https://public.api.bsky.app/xrpc/app.bsky.graph.getFollows?**';
  await context.route(follows, hold);
  await page.goto(origin);
  await shelf.getByRole('link', { name: other.metadata.title, exact: true }).waitFor();
  release();
  await context.unroute(follows, hold);
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: /^you\b/ }).click();
  await page.getByRole('dialog', { name: 'account', exact: true }).getByRole('link', { name: /^settings/ }).click();
};
