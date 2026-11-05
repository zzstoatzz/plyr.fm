export interface Follow {
  did: string;
  avatar: string | null;
}

function parseFollows(value: unknown): { follows: Follow[]; cursor?: string } {
  if (!value || typeof value !== 'object' || !('follows' in value) || !Array.isArray(value.follows)) {
    throw new Error('could not read your follows.');
  }
  const follows = value.follows.map((profile: unknown): Follow => {
    if (!profile || typeof profile !== 'object' || !('did' in profile) || typeof profile.did !== 'string' || !profile.did.startsWith('did:')) {
      throw new Error('could not read your follows.');
    }
    return { did: profile.did, avatar: 'avatar' in profile && typeof profile.avatar === 'string' ? profile.avatar : null };
  });
  if ('cursor' in value && value.cursor !== undefined && typeof value.cursor !== 'string') throw new Error('invalid follows cursor.');
  return { follows, cursor: 'cursor' in value && typeof value.cursor === 'string' ? value.cursor : undefined };
}

export async function readFollows(actor: string, signal: AbortSignal, request: typeof fetch = fetch): Promise<Follow[]> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) controller.abort();
  const timer = setTimeout(abort, 30_000);
  const follows = new Map<string, Follow>();
  const cursors = new Set<string>();
  let cursor: string | undefined;
  try {
    for (let page = 0; page < 100; page += 1) {
      const url = new URL('https://public.api.bsky.app/xrpc/app.bsky.graph.getFollows');
      url.searchParams.set('actor', actor);
      url.searchParams.set('limit', '100');
      if (cursor) url.searchParams.set('cursor', cursor);
      const response = await request(url, { signal: controller.signal });
      if (!response.ok) throw new Error('could not load artists you know.');
      const result = parseFollows(await response.json());
      for (const follow of result.follows) follows.set(follow.did, follow);
      cursor = result.cursor;
      if (!cursor) return [...follows.values()].reverse();
      if (cursors.has(cursor)) throw new Error('follows pagination did not advance.');
      cursors.add(cursor);
    }
    throw new Error('your follow list is too large to load here.');
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', abort);
  }
}

export async function resolveFollowArtists<T extends { did: string; avatar_url: string | null }>(
  follows: Follow[], resolve: (dids: string[], signal: AbortSignal) => Promise<T[]>, signal: AbortSignal,
): Promise<T[]> {
  const artists = new Map<string, T>();
  let next = 0;
  async function worker() {
    while (next < follows.length) {
      if (signal.aborted) throw new Error('Cancelled');
      const batch = follows.slice(next, next + 500);
      next += batch.length;
      const found = await resolve(batch.map(({ did }) => did), signal);
      for (const artist of found) artists.set(artist.did, artist);
    }
  }
  await Promise.all([worker(), worker()]);
  return follows.flatMap((follow) => {
    const artist = artists.get(follow.did);
    return artist ? [{ ...artist, avatar_url: follow.avatar ?? artist.avatar_url }] : [];
  });
}
