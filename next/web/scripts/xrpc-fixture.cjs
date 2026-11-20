// The appview's XRPC methods, for fixtures that stand in for api.next.plyr.fm.
const prefix = '/xrpc/fm.plyr.unspecced.';

/** the path of an unspecced method */
const xrpc = name => prefix + name;

/** the method an appview request calls, or undefined for anything else */
const method = url => url.pathname.startsWith(prefix) ? url.pathname.slice(prefix.length) : undefined;

/** the AT-URI inside a trk_/alb_/pls_ id, or the id itself, exactly as the client decodes it */
function uriFromId(id) {
  const match = /^(?:trk|alb|pls)_([A-Za-z0-9_-]+)$/.exec(id);
  if (!match) return id;
  try {
    const uri = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(match[1], 'base64url'));
    return uri.startsWith('at://') ? uri : id;
  } catch {
    return id;
  }
}

/** whether a request names the record behind this id (by uri, or by legacyId for numeric ids) */
const names = (url, id) => url.searchParams.get('uri') === uriFromId(String(id)) || url.searchParams.get('legacyId') === String(id);

/** the /v1 track id for an AT-URI */
const trackIdFromUri = uri => 'trk_' + Buffer.from(uri).toString('base64url');

module.exports = { xrpc, method, names, uriFromId, trackIdFromUri };
