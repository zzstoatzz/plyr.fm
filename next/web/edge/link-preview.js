// @ts-nocheck: plain JS shipped to Cloudflare as-is (no bundler step); tests/link-preview.test.ts covers it
// Link previews for a static app. next web is a single-page app, so the HTML for
// /track/123 is the same empty shell for every track and a link pasted into
// bluesky, discord, slack or imessage would unfurl as a bare "plyr.fm". This is
// the Cloudflare Pages worker (built to `build/_worker.js`) that, for link
// unfurlers only, reads the appview and writes the page's title, Open Graph and
// twitter tags into that shell. People in a browser get the static file
// untouched, so the app never waits on it. It also serves `/oembed`, which
// embed services (iframely and friends) discover from those tags.
//
// Only the routes in `_routes.json` reach this worker; everything else is served
// straight from the static assets.

const SITE_NAME = 'plyr.fm';
const SITE_DESCRIPTION = 'discover and stream audio on the AT Protocol with plyr.fm';
const API_TIMEOUT_MS = 6_000;
const API_CACHE_SECONDS = 300;
const ADULT_LABELS = new Set(['sexual', 'porn', 'nudity']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// production's playlist ids (uuids) → their records, snapshotted from prod's
// /lists/by-uri on 2026-11-21 for every playlist next indexes. scripts/build-edge.mjs
// fills it from edge/legacy-playlists.json.
const LEGACY_PLAYLISTS = /* legacy-playlists */ {};

// A browser navigation sends Sec-Fetch-Mode: navigate; unfurlers send no
// Sec-Fetch headers. Some unfurlers drive a headless browser, so their user
// agent still sends them to the preview path.
const UNFURLER = /bot|crawl|spider|slurp|facebookexternalhit|facebot|embedly|iframely|cardyb|bluesky|discord|slack|telegram|whatsapp|signal|mastodon|pleroma|akkoma|misskey|skype|linkedin|pinterest|vkshare|redditbot|preview|headless|lighthouse/i;

export function wantsPreview(request) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return false;
  const ua = request.headers.get('user-agent') || '';
  if (UNFURLER.test(ua)) return true;
  return request.headers.get('sec-fetch-mode') !== 'navigate';
}

/** production's album slug (backend/utilities/slugs.py), to resolve /u/{handle}/album/{slug} links */
export function slugify(text, maxLength = 100) {
  let slug = (text || '')
    .normalize('NFKD')
    .replace(/[^\x00-\x7f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (slug.length > maxLength) {
    slug = slug.slice(0, maxLength);
    const hyphen = slug.lastIndexOf('-');
    if (hyphen > 0) slug = slug.slice(0, hyphen);
  }
  return slug;
}

const decode = (segment) => { try { return decodeURIComponent(segment); } catch { return segment; } };

/** the page a path names, or null for pages without their own preview */
export function route(pathname) {
  const parts = pathname.replace(/\/+$/, '').split('/').slice(1).map(decode);
  const [kind, a, b, c] = parts;
  if (parts.length === 0) return { kind: 'home' };
  if (kind === 'atlas' && parts.length === 1) return { kind: 'atlas' };
  if (kind === 'radio' && parts.length <= 2) return { kind: 'radio', station: a || null };
  if (kind === 'track' && a && parts.length === 2) return { kind: 'track', id: a };
  if (kind === 'album' && a && parts.length === 2) return { kind: 'album', id: a };
  if (kind === 'playlist' && a && UUID.test(a) && parts.length === 2) return { kind: 'legacy-playlist', id: a };
  if (kind === 'playlist' && a && parts.length === 2) return { kind: 'playlist', id: a };
  if (kind === 'tag' && a && parts.length === 2) return { kind: 'tag', name: a };
  if (kind === 'jam' && a && parts.length === 2) return { kind: 'jam', room: a };
  if (kind === 'u' && a && parts.length === 2) return { kind: 'artist', actor: a };
  if (kind === 'u' && a && b === 'album' && c && parts.length === 4) return { kind: 'legacy-album', actor: a, slug: c };
  if (kind === 'embed' && a === 'playlist' && b && UUID.test(b) && parts.length === 3) return { kind: 'legacy-playlist', id: b, embed: true };
  if (kind === 'embed' && a === 'album' && b && c && parts.length === 4) return { kind: 'legacy-album', actor: b, slug: c, embed: true };
  if (kind === 'og' && ['track', 'album', 'playlist'].includes(a) && b?.endsWith('.jpg') && parts.length === 3) return { kind: 'og', of: a, id: b.slice(0, -4) };
  return null;
}

// production pages next folded into others. Old links, bookmarks and search
// results land on the page that does that job now instead of a 404.
const MOVED = [
  [/^\/u\/([^/]+)\/liked$/, (_, actor) => `/u/${actor}`],
  [/^\/liked\/([^/]+)$/, (_, actor) => `/u/${actor}`],
  [/^\/(?:for-you|activity)$/, () => '/'],
  [/^\/record$/, () => '/upload'],
  [/^\/costs$/, () => '/stats'],
  [/^\/profile\/setup$/, () => '/edit-profile'],
  [/^\/portal\/manage$/, () => '/portal']
];

/** where an old production path lives now, or null */
export function movedPath(pathname) {
  const path = pathname.replace(/\/+$/, '') || '/';
  for (const [pattern, target] of MOVED) {
    const match = pattern.exec(path);
    if (match) return target(...match);
  }
  return null;
}

/** an `/at/<at-uri>` link (production's at-uri resolver) as the next page for that record */
export async function atUriPath(pathname, api) {
  const raw = decode(pathname.replace(/^\/at\/?/, '')).replace(/^at:/, '').replace(/^:?\/{0,2}/, '');
  const [authority, collection, rkey] = raw.split('/');
  if (!authority?.startsWith('did:') && !authority?.includes('.')) return '/';
  if (!collection) return `/u/${authority}`;
  if (!rkey) return '/';
  const uri = `at://${authority}/${collection}/${rkey}`;
  if (collection.endsWith('.track')) return `/track/${idFromUri('trk_', uri)}`;
  if (collection.endsWith('.list')) return (await api.album(idFromUri('alb_', uri))) ? `/album/${idFromUri('alb_', uri)}` : `/playlist/${idFromUri('pls_', uri)}`;
  return `/u/${authority}`;
}

const AI_TRAINING = ['GPTBot', 'ClaudeBot', 'CCBot', 'Google-Extended', 'Applebot-Extended', 'anthropic-ai', 'Bytespider'];
const PRIVATE_PAGES = ['/portal', '/settings', '/library', '/liked', '/upload', '/edit-profile', '/edit-track', '/create-album', '/get-paid', '/login', '/queue', '/oauth', '/private', '/moderation', '/embed'];

/** search engines index plyr.fm itself; every other host (next., previews) stays out of results */
export function robots(origin) {
  if (new URL(origin).hostname !== 'plyr.fm') return 'User-agent: *\nDisallow: /\n';
  return [
    ...AI_TRAINING.map(agent => `User-agent: ${agent}\nDisallow: /\n`),
    'User-agent: *',
    'Allow: /',
    ...PRIVATE_PAGES.map(path => `Disallow: ${path}`),
    '',
    `Sitemap: ${origin}/sitemap.xml`,
    ''
  ].join('\n');
}

const LLMS_TXT = /* llms-txt */ '';

/** llms.txt (llmstxt.org) for this host: `edge/llms.txt` with its `{origin}` and `{api}` filled in */
export const llmsTxt = (origin, apiOrigin, template = LLMS_TXT) => template.replaceAll('{origin}', origin).replaceAll('{api}', apiOrigin);

const SITEMAP_PAGES = 20;
const xmlEscape = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** the public catalog's tracks and artists, newest first, for search engines */
export async function sitemap(origin, api) {
  const entries = new Map([['/', null], ['/radio', null], ['/atlas', null], ['/stats', null], ['/terms', null], ['/privacy', null]]);
  let cursor;
  for (let page = 0; page < SITEMAP_PAGES; page++) {
    const result = await api.tracks(cursor);
    for (const track of result?.data ?? []) {
      if (track.access?.visibility !== 'public') continue;
      const updated = track.metadata?.created_at?.slice(0, 10) ?? null;
      entries.set(`/track/${track.id}`, updated);
      const artist = `/u/${track.artist?.profile?.handle || track.artist?.did}`;
      if (!entries.has(artist)) entries.set(artist, updated);
    }
    cursor = result?.next_cursor;
    if (!result?.has_more || !cursor) break;
  }
  const urls = [...entries].map(([path, updated]) =>
    `  <url><loc>${xmlEscape(origin + path)}</loc>${updated ? `<lastmod>${updated}</lastmod>` : ''}</url>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;
}

/** reads the appview's `fm.plyr.unspecced.*` methods; null on any miss */
export function createApi(origin, fetcher = fetch) {
  const get = async (method, params) => {
    const url = new URL(`${origin}/xrpc/fm.plyr.unspecced.${method}`);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
    try {
      const response = await fetcher(url.href, {
        signal: controller.signal,
        headers: { accept: 'application/json' },
        cf: { cacheTtl: API_CACHE_SECONDS, cacheEverything: true }
      });
      return response.ok ? await response.json() : null;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  };
  return {
    track: (id) => get('getTrack', /^[1-9][0-9]*$/.test(id) ? { legacyId: id } : { uri: uriFromId(id) }),
    artist: (actor) => get('getArtist', { actor }),
    artistMetrics: (actor) => get('getArtistMetrics', { actor }),
    albums: (artistDid) => get('listAlbums', { artistDid, limit: '100' }),
    album: (id) => get('getAlbum', { uri: uriFromId(id) }),
    playlist: (id) => get('getPlaylist', { uri: uriFromId(id) }),
    tracks: (cursor) => get('listTracks', cursor ? { limit: '100', cursor } : { limit: '100' }),
    radioStations: () => get('getRadioStations', {}),
    // a broadcasting station only names its live stream when asked for more than the catalog
    radioState: (station) => get('getRadioState', { station, catalogOnly: String(station !== 'firehose') })
  };
}

// ids are a type prefix + the record; a copy of core/src/record-ids.ts, which
// must issue the same id (short `trk_<plc id>.<rkey>` or base64url of the uri)
const SHORT_COLLECTION = { trk_: 'fm.plyr.track', alb_: 'fm.plyr.list', pls_: 'fm.plyr.list' };
const SHORT_URI = /^at:\/\/did:plc:([a-z2-7]{24})\/([a-z.]+)\/([A-Za-z0-9._~-]{1,512})$/;
const SHORT_ID = /^(trk|alb|pls)_([a-z2-7]{24})\.([A-Za-z0-9._~-]{1,512})$/;

export function idFromUri(prefix, uri) {
  const short = SHORT_URI.exec(uri);
  if (short && short[2] === SHORT_COLLECTION[prefix] && short[3] !== '.' && short[3] !== '..') return `${prefix}${short[1]}.${short[3]}`;
  const bytes = new TextEncoder().encode(uri);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return prefix + btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function uriFromId(id) {
  const short = SHORT_ID.exec(id);
  if (short) return short[3] === '.' || short[3] === '..' ? id : `at://did:plc:${short[2]}/${SHORT_COLLECTION[`${short[1]}_`]}/${short[3]}`;
  const match = /^(?:trk|alb|pls)_([A-Za-z0-9_-]+)$/.exec(id);
  if (!match) return id;
  try {
    const payload = match[1].replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(payload + '='.repeat((4 - (payload.length % 4)) % 4));
    const uri = new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(bin, (ch) => ch.charCodeAt(0)));
    return uri.startsWith('at://') ? uri : id;
  } catch {
    return id;
  }
}

/** the id the appview issues for an id, so an older long link moves to the short one */
export function canonicalId(id) {
  const prefix = /^(trk|alb|pls)_/.exec(id)?.[0];
  const uri = uriFromId(id);
  return prefix && uri !== id ? idFromUri(prefix, uri) : id;
}

const plyrImage = /^https:\/\/images(?:-stg)?\.plyr\.fm\/(?!cdn-cgi\/)[^?#]+$/;
const legacyBucket = /^https:\/\/pub-7ea7ea9a6f224f4f8c0321a2bb008c5a\.r2\.dev\/images\//;

/**
 * Artwork for a card. Uploaded art can be a 20 MB phone photo, which unfurlers
 * time out on or refuse, so plyr images are resized at the edge to a 1200px
 * JPEG (every unfurler reads JPEG; not all read WebP).
 */
export function cardImage(url) {
  if (!url) return null;
  const canonical = url.replace(legacyBucket, 'https://images.plyr.fm/images/');
  if (!plyrImage.test(canonical)) return { url: canonical, source: canonical };
  const parsed = new URL(canonical);
  return {
    url: `${parsed.origin}/cdn-cgi/image/width=1200,height=1200,fit=scale-down,quality=85,format=jpeg${parsed.pathname}`,
    type: 'image/jpeg',
    source: canonical
  };
}

const isAdult = (track) =>
  [track.moderation?.self_labels, track.moderation?.operator_labels].some((labels) => labels?.some((label) => ADULT_LABELS.has(label)));

const isOpen = (track) => track.access?.visibility === 'public' && !track.access.gate && !track.access.space_uri;

const embeddable = (track) => isOpen(track) && !isAdult(track);

const artistName = (track) => track.metadata.artist_name?.trim() || track.artist.profile.display_name || track.artist.profile.handle;

const plural = (count, noun) => `${count} ${noun}${count === 1 ? '' : 's'}`;

function duration(seconds) {
  if (!seconds || seconds < 1) return null;
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rest = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${rest}` : `${m}:${rest}`;
}

// a list's own cover, else its first member with art (as the app draws it), else the owner
function listArtwork(list) {
  const member = (list.members || []).find((m) => m.track?.media?.artwork?.url && !isAdult(m.track));
  return list.media?.artwork?.url || member?.track.media.artwork.url || list.owner?.profile?.avatar_url || null;
}

function listDuration(list) {
  const total = (list.members || []).reduce((sum, member) => sum + (member.track?.metadata?.duration_seconds || 0), 0);
  return duration(total);
}

/**
 * What a card for this page shows, or a redirect for an old production link.
 * Returns null when the page has nothing of its own to show (the static
 * site-wide card then stands).
 */
export async function preview(url, api, legacyPlaylists = LEGACY_PLAYLISTS) {
  const page = route(url.pathname);
  if (!page) return null;
  const origin = url.origin;

  if (page.kind === 'track') {
    const track = await api.track(page.id);
    if (!track || track.access?.visibility === 'private') return null;
    const artist = artistName(track);
    const path = `/track/${track.legacy_id || track.id}`;
    const adult = isAdult(track);
    const art = adult ? null : cardImage(track.media?.artwork?.url || track.artist.profile.avatar_url);
    const canonicalId = track.legacy_id || track.id;
    const length = duration(track.metadata.duration_seconds);
    const audio = embeddable(track) ? track.media?.origins?.find((o) => /^https:\/\/audio\.plyr\.fm\//.test(o.url)) : null;
    return {
      type: 'music.song',
      title: `${track.metadata.title} - ${artist}`,
      shortTitle: track.metadata.title,
      description: [artist, track.metadata.album, length].filter(Boolean).join(' • '),
      url: origin + path,
      image: art && { url: `${origin}/og/track/${canonicalId}.jpg`, type: 'image/jpeg', width: 1200, height: 630, fallback: art.url, source: art.source },
      imageAlt: `${track.metadata.title} by ${artist}`,
      large: Boolean(art),
      audio: audio ? { url: audio.url, type: audio.media_type?.includes('/') ? audio.media_type : `audio/${audio.media_type || 'mpeg'}` } : null,
      author: { name: artist, url: `${origin}/u/${track.artist.profile.handle || track.artist.did}` },
      music: { duration: track.metadata.duration_seconds, musician: `${origin}/u/${track.artist.profile.handle || track.artist.did}` },
      oembed: embeddable(track) ? origin + path : null,
      at: { canonical: track.record?.uri, author: `at://${track.artist.did}` }
    };
  }

  if (page.kind === 'artist') {
    const [artist, metrics] = await Promise.all([api.artist(page.actor), api.artistMetrics(page.actor)]);
    if (!artist) return null;
    const name = artist.display_name || artist.handle;
    const tracks = metrics?.totals?.tracks;
    return {
      type: 'profile',
      title: name,
      shortTitle: name,
      description: `@${artist.handle}${tracks ? ` · ${plural(tracks, 'track')}` : ''} on ${SITE_NAME}`,
      url: `${origin}/u/${artist.handle}`,
      image: cardImage(artist.avatar_url),
      imageAlt: name,
      large: false,
      author: { name, url: `${origin}/u/${artist.handle}` },
      oembed: tracks ? `${origin}/u/${artist.handle}` : null,
      at: { author: `at://${artist.did}` }
    };
  }

  if (page.kind === 'legacy-album') {
    const artist = await api.artist(page.actor);
    if (!artist) return null;
    const albums = await api.albums(artist.did);
    const album = albums?.data?.find((list) => slugify(list.metadata?.name) === page.slug);
    return album ? { redirect: `${origin}${page.embed ? '/embed' : ''}/album/${album.id}${url.search}` } : null;
  }

  if (page.kind === 'legacy-playlist') {
    const uri = Object.hasOwn(legacyPlaylists, page.id) ? legacyPlaylists[page.id] : null;
    return uri ? { redirect: `${origin}${page.embed ? '/embed' : ''}/playlist/${idFromUri('pls_', uri)}${url.search}` } : null;
  }

  if (page.kind === 'album' || page.kind === 'playlist') {
    const list = await (page.kind === 'album' ? api.album(page.id) : api.playlist(page.id));
    if (!list) return null;
    const name = list.metadata?.name || page.kind;
    const owner = list.owner?.profile?.display_name || list.owner?.profile?.handle || 'someone';
    const count = list.metrics?.available_count ?? list.members?.length ?? 0;
    const art = cardImage(listArtwork(list));
    return {
      type: page.kind === 'album' ? 'music.album' : 'music.playlist',
      title: `${name} by ${owner}`,
      shortTitle: name,
      description: [page.kind === 'album' ? `album by ${owner}` : `playlist by ${owner}`, count ? plural(count, 'track') : null, listDuration(list)].filter(Boolean).join(' • '),
      url: `${origin}/${page.kind}/${list.id}`,
      image: art && { url: `${origin}/og/${page.kind}/${list.id}.jpg`, type: 'image/jpeg', width: 1200, height: 630, fallback: art.url, source: art.source },
      imageAlt: `${name} by ${owner}`,
      large: Boolean(art),
      author: { name: owner, url: `${origin}/u/${list.owner?.profile?.handle || list.owner?.did}` },
      oembed: count ? `${origin}/${page.kind}/${list.id}` : null,
      at: { canonical: list.record?.uri, author: list.owner?.did ? `at://${list.owner.did}` : null }
    };
  }

  if (page.kind === 'home') {
    return {
      type: 'website',
      title: `${SITE_NAME} - audio streaming app`,
      description: SITE_DESCRIPTION,
      url: `${origin}/`
    };
  }

  if (page.kind === 'atlas') {
    const image = { url: `${origin}/previews/atlas.jpg`, type: 'image/jpeg', width: 1200, height: 630 }; // refresh: bun run atlas:preview
    const alt = `the ${SITE_NAME} atlas: tracks grouped into glowing neighborhoods by how they sound`;
    return { type: 'website', title: `the ${SITE_NAME} atlas`, shortTitle: 'atlas', description: 'the catalog, mapped by sound. zoom in and select a track to play it.', url: `${origin}/atlas`, image, imageAlt: alt, large: true };
  }

  if (page.kind === 'radio') {
    if (!page.station) return { type: 'website', title: `radio on ${SITE_NAME}`, shortTitle: 'radio', description: 'always on. pick a station and listen along with everyone else.', url: `${origin}/radio` };
    const station = (await api.radioStations())?.stations?.find((s) => s.slug === page.station);
    if (!station) return null;
    // the card is read once and kept by whoever unfurls it, so it names the station, not the song
    const state = await api.radioState(station.slug);
    const art = cardImage(state?.live?.artwork_url || state?.current?.artwork_url);
    const onAir = state?.live ? 'on air now' : state?.current ? `now playing ${state.current.title} by ${state.current.artist}` : null;
    return {
      type: 'website',
      title: `${station.name} radio on ${SITE_NAME}`,
      shortTitle: `${station.name} radio`,
      description: [station.description, onAir].filter(Boolean).join(' · '),
      url: `${origin}/radio/${encodeURIComponent(station.slug)}`,
      image: art,
      imageAlt: `${station.name} radio`,
      large: false
    };
  }

  if (page.kind === 'tag') {
    return {
      type: 'website',
      title: `#${page.name} on ${SITE_NAME}`,
      shortTitle: `#${page.name}`,
      description: `tracks tagged #${page.name} on ${SITE_NAME}`,
      url: `${origin}/tag/${encodeURIComponent(page.name)}`
    };
  }

  if (page.kind === 'jam') {
    return {
      type: 'website',
      title: `join the jam on ${SITE_NAME}`,
      shortTitle: 'join the jam',
      description: `listen along together on ${SITE_NAME}`,
      url: `${origin}/jam/${encodeURIComponent(page.room)}`
    };
  }

  return null;
}

const escape = (text) =>
  String(text).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);

const meta = (key, name, content) => (content || content === 0 ? `<meta ${key}="${name}" content="${escape(content)}" />` : '');

/** the head tags for a card; `fallbackImage` stands in when the page has no art */
export function headTags(card, fallbackImage) {
  const image = card.image || { url: fallbackImage };
  const tags = [
    `<title>${escape(card.title.endsWith(SITE_NAME) || card.title.startsWith(SITE_NAME) ? card.title : `${card.title} | ${SITE_NAME}`)}</title>`,
    meta('name', 'description', card.description),
    `<link rel="canonical" href="${escape(card.url)}" />`,
    meta('property', 'og:type', card.type),
    meta('property', 'og:site_name', SITE_NAME),
    meta('property', 'og:title', card.title),
    meta('property', 'og:description', card.description),
    meta('property', 'og:url', card.url),
    meta('property', 'og:image', image.url),
    meta('property', 'og:image:secure_url', image.url),
    meta('property', 'og:image:type', image.type),
    meta('property', 'og:image:width', image.width),
    meta('property', 'og:image:height', image.height),
    meta('property', 'og:image:alt', card.image ? card.imageAlt : SITE_NAME),
    card.audio ? meta('property', 'og:audio', card.audio.url) : '',
    card.audio ? meta('property', 'og:audio:type', card.audio.type) : '',
    card.music?.duration ? meta('property', 'music:duration', Math.round(card.music.duration)) : '',
    card.music?.musician ? meta('property', 'music:musician', card.music.musician) : '',
    meta('name', 'twitter:card', card.large ? 'summary_large_image' : 'summary'),
    meta('name', 'twitter:title', card.shortTitle || card.title),
    meta('name', 'twitter:description', card.description),
    meta('name', 'twitter:image', image.url),
    meta('name', 'twitter:image:alt', card.image ? card.imageAlt : SITE_NAME),
    card.oembed
      ? `<link rel="alternate" type="application/json+oembed" href="${escape(`${new URL(card.url).origin}/oembed?url=${encodeURIComponent(card.oembed)}&format=json`)}" title="${escape(card.title)}" />`
      : '',
    card.at?.canonical ? meta('name', 'at:canonical', card.at.canonical) : '',
    card.at?.author ? meta('name', 'at:author', card.at.author) : ''
  ];
  return tags.filter(Boolean).join('\n\t\t');
}

const PREVIEW_BLOCK = /<!-- link-preview -->[\s\S]*?<!-- \/link-preview -->/;

/** the static shell with its site-wide card swapped for this page's */
export function injectCard(html, card, fallbackImage) {
  const tags = `<!-- link-preview -->\n\t\t${headTags(card, fallbackImage)}\n\t\t<!-- /link-preview -->`;
  const withoutTitle = html.replace(/<title>[\s\S]*?<\/title>\s*/, '');
  return PREVIEW_BLOCK.test(withoutTitle) ? withoutTitle.replace(PREVIEW_BLOCK, () => tags) : withoutTitle.replace('</head>', () => `${tags}\n\t</head>`);
}

const OEMBED_SIZES = { track: [400, 165, 165], album: [400, 380, 600], playlist: [400, 380, 600], artist: [400, 380, 600] };

/** oEmbed for a plyr.fm page link: a rich embed of its player */
export async function oembed(requestUrl, api) {
  const target = requestUrl.searchParams.get('url');
  const format = requestUrl.searchParams.get('format') || 'json';
  if (format !== 'json') return { status: 501, body: { error: 'only json format is supported' } };
  if (!target) return { status: 400, body: { error: 'url is required' } };
  let parsed;
  try { parsed = new URL(target); } catch { return { status: 404, body: { error: 'unsupported url' } }; }
  const origin = requestUrl.origin;
  let path = parsed.pathname;
  let page = route(path);
  if (page?.kind === 'legacy-album' || page?.kind === 'legacy-playlist') {
    const moved = await preview(new URL(path, origin), api);
    path = moved?.redirect ? new URL(moved.redirect).pathname : path;
    page = moved?.redirect ? route(path) : null;
  }
  if (!page || !['track', 'album', 'playlist', 'artist'].includes(page.kind)) return { status: 404, body: { error: 'unsupported url' } };

  let card;
  let embedPath;
  if (page.kind === 'track') {
    const track = await api.track(page.id);
    if (!track || !embeddable(track)) return { status: 404, body: { error: 'track not found' } };
    card = await preview(new URL(`/track/${page.id}`, origin), { track: async () => track });
    embedPath = `/embed/track/${track.legacy_id || track.id}`;
  } else {
    card = await preview(new URL(path, origin), api);
    if (!card?.oembed) return { status: 404, body: { error: `${page.kind} not found` } };
    embedPath = `/embed${new URL(card.url).pathname}`;
  }

  const [defaultWidth, defaultHeight, maxHeight] = OEMBED_SIZES[page.kind];
  const askedWidth = Number(requestUrl.searchParams.get('maxwidth')) || defaultWidth;
  const askedHeight = Number(requestUrl.searchParams.get('maxheight')) || defaultHeight;
  // never larger than the caller's maxwidth/maxheight (oEmbed 2.2.1)
  const width = Math.min(askedWidth, 800);
  const height = Math.min(askedHeight, maxHeight);
  const body = {
    version: '1.0',
    type: 'rich',
    provider_name: SITE_NAME,
    provider_url: origin,
    title: card.title,
    author_name: card.author.name,
    author_url: card.author.url,
    width,
    height,
    html: `<iframe src="${escape(origin + embedPath)}" width="${width}" height="${height}" frameborder="0" allow="autoplay; encrypted-media" style="border-radius: 8px;"></iframe>`,
    cache_age: API_CACHE_SECONDS
  };
  if (card.image) Object.assign(body, { thumbnail_url: card.image.url, thumbnail_width: card.image.width || 400, thumbnail_height: card.image.height || 400 });
  return { status: 200, body };
}

/**
 * The 1200×630 card: the whole cover, centred over a blurred, dimmed fill of
 * itself, with the plyr.fm mark in the corner. Unfurlers crop a square cover
 * to fit their wide frame; this keeps all of it. Drawn by Cloudflare's image
 * transformations, so it needs no image code here.
 */
export function cardComposition(source, origin) {
  return {
    width: 1200,
    height: 630,
    fit: 'cover',
    blur: 90,
    brightness: 0.45,
    format: 'jpeg',
    quality: 85,
    draw: [
      { url: source, width: 540, height: 540, fit: 'contain' },
      { url: `${origin}/icons/icon-512.png`, width: 64, bottom: 30, right: 34, opacity: 0.92 }
    ]
  };
}

/** the composed card for /og/{kind}/{id}.jpg; the plain resized cover if composing fails */
export async function ogImage(page, origin, api, fetcher = fetch) {
  const card = await preview(new URL(`/${page.of}/${encodeURIComponent(page.id)}`, origin), api).catch(() => null);
  const image = card?.image;
  if (!image?.source) return Response.redirect(`${origin}/icons/icon-512.png`, 302);
  try {
    const response = await fetcher(image.source, { cf: { image: cardComposition(image.source, origin) } });
    const type = response.headers.get('content-type') || '';
    // without cf-resized (or with cf-resized: err=…) the transformation didn't run and this is the raw upload
    const resized = response.headers.get('cf-resized');
    if (response.ok && type.startsWith('image/') && resized && !/err=/.test(resized)) {
      return new Response(response.body, {
        headers: { 'content-type': type, 'cache-control': 'public, max-age=86400', 'x-plyr-og': 'composed' }
      });
    }
  } catch {}
  return new Response(null, { status: 302, headers: { location: image.fallback, 'cache-control': 'public, max-age=300', 'x-plyr-og': 'fallback' } });
}

const API_ORIGIN = '__PLYR_API_ORIGIN__';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const apiOrigin = API_ORIGIN.startsWith('http') ? API_ORIGIN : 'https://api.next.plyr.fm';
    const api = createApi(apiOrigin);

    if (url.pathname === '/oembed') {
      const { status, body } = await oembed(url, api);
      return new Response(JSON.stringify(body), {
        status,
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'access-control-allow-origin': '*',
          'cache-control': status === 200 ? `public, max-age=${API_CACHE_SECONDS}` : 'public, max-age=60'
        }
      });
    }

    if (url.pathname === '/robots.txt' || url.pathname === '/llms.txt') {
      const text = url.pathname === '/robots.txt' ? robots(url.origin) : llmsTxt(url.origin, apiOrigin);
      return new Response(text, { headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=3600' } });
    }
    if (url.pathname === '/sitemap.xml') {
      return new Response(await sitemap(url.origin, api), { headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=3600' } });
    }
    const moved = url.pathname.startsWith('/at/') ? await atUriPath(url.pathname, api) : movedPath(url.pathname);
    if (moved) return Response.redirect(new URL(moved + url.search, url.origin).href, 301);

    const page = route(url.pathname);
    if ((page?.kind === 'track' || page?.kind === 'album' || page?.kind === 'playlist') && canonicalId(page.id) !== page.id) {
      return Response.redirect(new URL(`/${page.kind}/${canonicalId(page.id)}${url.search}`, url.origin).href, 301);
    }
    if (page?.kind === 'og') return ogImage(page, url.origin, api);
    // old production album and playlist links move for everyone, not only unfurlers
    if (page?.kind === 'legacy-album' || page?.kind === 'legacy-playlist') {
      const moved = await preview(url, api).catch(() => null);
      if (moved?.redirect) return Response.redirect(moved.redirect, 301);
      return env.ASSETS.fetch(request);
    }
    if (!page || !wantsPreview(request)) return env.ASSETS.fetch(request);

    const [shell, card] = await Promise.all([
      env.ASSETS.fetch(new Request(new URL('/', url), request)),
      preview(url, api).catch(() => null)
    ]);
    if (!card || card.redirect || !shell.ok) return env.ASSETS.fetch(request);
    const html = injectCard(await shell.text(), card, `${url.origin}/icons/icon-512.png`);
    const headers = new Headers(shell.headers);
    headers.delete('content-length');
    headers.delete('etag');
    headers.set('content-type', 'text/html; charset=utf-8');
    headers.set('cache-control', 'public, max-age=0, must-revalidate');
    headers.set('x-plyr-preview', page.kind);
    return new Response(request.method === 'HEAD' ? null : html, { status: 200, headers });
  }
};
