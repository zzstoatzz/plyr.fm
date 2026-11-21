// A self-contained catalog for browser checks: serves the built app from dist and answers api.next.plyr.fm, art and audio
// from fixtures, so a check runs with no network (CI included). Pictures come from FIXTURE_IMAGES (a folder of .jpg) when set,
// otherwise every cover is a generated tile.
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { method, names } = require('./xrpc-fixture.cjs');
const dist = process.env.PLAYER_DIST || path.resolve(__dirname, '../build');
const images = process.env.FIXTURE_IMAGES || process.env.QUEUE_PANEL_IMAGES;

const artistDid = 'did:plc:fixtureartist';
const tracks = Array.from({ length: 9 }, (_, index) => {
  const uri = `at://${artistDid}/fm.plyr.track/t${index}`;
  return {
    object: 'track', id: 'trk_' + Buffer.from(uri).toString('base64url'),
    record: { uri, cid: `bafy${index}`, revision: null, collection: 'fm.plyr.track', rkey: `t${index}` },
    metadata: { title: `${String(300 + index * 7)} - sketch number ${index + 1}${index ? '' : ', recorded on the porch at dawn with the window open and the dog joining in'}`, description: index ? null : 'A recording made at dawn.\n\nThe dog joined in.', ...(index ? {} : { tags: ['ambient', 'home recordings'] }), album: null, duration_seconds: 120 + index * 31, created_at: `2026-11-0${index + 1}T00:00:00Z` },
    artist: { did: artistDid, profile: { handle: 'sketches.test', display_name: 'replyomatic', avatar_url: 'https://panel-fixture.invalid/avatar.jpg', bio: 'ambient sketches, one a day, numbered as they come.' } },
    media: { artwork: { url: `https://panel-fixture.invalid/art/${index}.jpg` } }, access: { visibility: 'public' }, metrics: { play_count: 9 - index, like_count: 3 }
  };
});
const audio = Buffer.alloc(44 + 8000 * 240 * 2);
const collectionTracks = [tracks[2], tracks[0], tracks[1]];
// an artist who never turned comments on
const commentsOff = tracks[3].id;
audio.write('RIFF', 0); audio.writeUInt32LE(audio.length - 8, 4); audio.write('WAVEfmt ', 8);
audio.writeUInt32LE(16, 16); audio.writeUInt16LE(1, 20); audio.writeUInt16LE(1, 22);
audio.writeUInt32LE(8000, 24); audio.writeUInt32LE(16000, 28); audio.writeUInt16LE(2, 32);
audio.writeUInt16LE(16, 34); audio.write('data', 36); audio.writeUInt32LE(audio.length - 44, 40);
const pictures = images ? fs.readdirSync(images).filter(name => name.endsWith('.jpg')).sort().map(name => path.join(images, name)) : [];
const server = http.createServer((request, response) => {
  let filename = path.join(dist, decodeURIComponent(request.url.split('?')[0]));
  if (!fs.existsSync(filename) || fs.statSync(filename).isDirectory()) filename = path.join(dist, 'index.html');
  response.setHeader('Content-Type', filename.endsWith('.js') ? 'text/javascript' : filename.endsWith('.css') ? 'text/css' : filename.endsWith('.json') ? 'application/json' : 'text/html');
  response.end(fs.readFileSync(filename));
});

async function serveAudio(route) {
  const range = /^bytes=(\d+)-(\d*)$/.exec(route.request().headers().range || '');
  const start = range ? Number(range[1]) : 0;
  const end = range?.[2] ? Math.min(Number(range[2]), audio.length - 1) : audio.length - 1;
  const body = audio.subarray(start, end + 1);
  await route.fulfill({ status: range ? 206 : 200, body, headers: { 'content-type': 'audio/wav', 'content-length': String(body.length), 'accept-ranges': 'bytes',
    'access-control-allow-origin': '*', ...(range ? { 'content-range': `bytes ${start}-${end}/${audio.length}` } : {}) } });
}

const atlasCluster = { id: 0, label: 'field recordings', cx: 0, cy: 0, count: 1 };
const atlas = {
  points: [{
    id: 19, x: 0, y: 0, title: tracks[0].metadata.title, artist: 'replyomatic', handle: 'sketches.test',
    thumb: '', plays: 9, likes: 3, clusterCoarse: 0, clusterFine: 0, core: true
  }],
  artists: [], clusters: { coarse: [atlasCluster], fine: [{ ...atlasCluster, parent: 0 }] },
  meta: { generatedAt: '2026-11-14T00:00:00Z', nTracks: 1 }
};

async function setup(browser, width, height = 900, options = {}) {
  const scheme = options.scheme || 'dark';
  const context = await browser.newContext({ viewport: { width, height }, colorScheme: scheme, isMobile: !!options.phone, hasTouch: !!options.phone, deviceScaleFactor: Number(process.env.FIXTURE_SCALE || 1) });
  await context.addInitScript(({ theme, scale }) => localStorage.setItem('plyr-next:prefs', JSON.stringify({ theme, scale, playThrough: true })), { theme: scheme, scale: options.scale || 1 });
  await context.route('**/*', route => ['GET', 'HEAD', 'OPTIONS'].includes(route.request().method()) ? route.continue() : route.abort());
  await context.route('https://panel-fixture.invalid/**', async route => {
    const url = new URL(route.request().url()).pathname;
    const picture = /\/art\/(\d+)\.jpg$/.exec(url);
    if (picture || url.endsWith('/avatar.jpg')) {
      const file = pictures.length ? pictures[picture ? Number(picture[1]) % pictures.length : pictures.length - 1] : undefined;
      if (file) await route.fulfill({ body: fs.readFileSync(file), contentType: 'image/jpeg' });
      else await route.fulfill({ body: tile(picture ? Number(picture[1]) : 99), contentType: 'image/svg+xml' });
      return;
    }
    await serveAudio(route);
  });
  const page = await context.newPage();
  page.setDefaultTimeout(20_000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('https://api.plyr.fm/stats/atlas', route => route.fulfill({ json: atlas }));
  await page.route('https://api.next.plyr.fm/**', async route => {
    const url = new URL(route.request().url());
    const call = method(url);
    const byId = ['getTrack', 'getPlayback', 'getTrackComments'].includes(call) ? tracks.find(track => names(url, track.id)) : undefined;
    let body = { object: 'list', data: [], has_more: false };
    if (byId && call === 'getPlayback') body = { object: 'playback', track_id: byId.id, record: byId.record,
      availability: { status: 'available', delivery: { url: 'https://panel-fixture.invalid/audio.wav', media_type: 'audio/wav' } } };
    else if (byId && call === 'getTrack') body = { ...byId, metadata: { ...byId.metadata, tags: ['ambient', 'home recordings', 'field & nature'] } };
    else if (byId && call === 'getTrackComments') body = { ...body, comments_enabled: byId.id !== commentsOff, data: byId.id === commentsOff ? [] : [{
      record: { uri: 'at://did:plc:listener/fm.plyr.comment/123', cid: 'bafycomment', rkey: '123' },
      author: { did: 'did:plc:listener', handle: 'listener.example', display_name: 'A Listener', avatar_url: null },
      subject: byId.record, text: 'I love this moment.', timestamp_ms: 14_000, created_at: '2026-11-03T20:00:00Z', updated_at: null
    }] };
    else if (call === 'getTrack' && url.searchParams.get('uri') === 'missing-track') {
      await route.fulfill({ status: 400, json: { error: 'InvalidRequest', message: 'The request is invalid.' } });
      return;
    }
    else if (call === 'getStats') body = { object: 'platform_stats', tracks: 9, artists: 1, duration_seconds: 2000, plays: 9, updated_at_ms: 1794651020000 };
    else if (call === 'listTracks') body = { object: 'list', data: tracks, has_more: false };
    else if ((call === 'getAlbum' || call === 'getPlaylist') && url.searchParams.get('uri') === 'fixture') {
      const kind = call === 'getAlbum' ? 'album' : 'playlist';
      const members = collectionTracks.map((track, position) => ({ position, track, subject: track.record, availability: 'available' }));
      members.splice(1, 0, { position: 3, track: null, subject: tracks[3].record, availability: 'unavailable' });
      body = {
        object: kind, id: 'fixture', record: { uri: `at://${artistDid}/fm.plyr.list/${kind}` },
        metadata: { name: `Fixture ${kind}` }, owner: { did: artistDid, profile: tracks[0].artist.profile },
        members, metrics: { member_count: members.length, available_count: 3, total_plays: 0 },
        media: { artwork: collectionTracks[0].media.artwork }
      };
    }
    else if (call === 'getTrackChart') body = { period: url.searchParams.get('period') || 'week', data: tracks.map((track, index) => ({ rank: index + 1, track, plays: 1, likes: track.metrics.like_count })) };
    else if (call === 'getArtistMetrics') body = { totals: { plays: 9, tracks: 9, duration_seconds: 2000 }, top_track: null };
    else if (call === 'getArtist') body = { object: 'artist', did: artistDid, handle: 'sketches.test', display_name: 'replyomatic', bio: null, avatar_url: null, support_url: null };
    await route.fulfill({ json: body });
  });
  return { context, page, errors };
}


function tile(index) {
  const hue = (index * 47) % 360;
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600"><rect width="600" height="600" fill="hsl(${hue} 55% 40%)"/><circle cx="300" cy="300" r="170" fill="hsl(${(hue + 120) % 360} 60% 62%)"/></svg>`);
}

async function serve() {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${server.address().port}`;
}

module.exports = { artistDid, atlas, tracks, collectionTracks, serveAudio, setup, serve, close: () => server.close() };
