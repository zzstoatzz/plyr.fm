import { useEffect, useState } from 'react';
import { api } from './api-client';
import { type ListSummary, type Track } from '@plyr/next-core/api';

const byArtist = new Map<string, Promise<ListSummary[]>>();

/** A track names its album by title only; the artist's album with that name, if one exists. */
export function albumFor(name: string | null, albums: ListSummary[]): ListSummary | null {
  const wanted = name?.trim().toLowerCase();
  if (!wanted) return null;
  return albums.find(album => album.metadata.name?.trim().toLowerCase() === wanted) ?? null;
}

/** The artist's album record this track names, once looked up. */
export function useAlbum(track: Track): ListSummary | null {
  const [found, setFound] = useState<{ track: string; album: ListSummary | null } | null>(null);
  const { album } = track.metadata;
  const did = track.artist.did;
  useEffect(() => {
    if (!album) return;
    let live = true;
    let albums = byArtist.get(did);
    if (!albums) {
      albums = api.albums(did, { limit: 100 }).then(page => page.data);
      albums.catch(() => byArtist.delete(did));
      byArtist.set(did, albums);
    }
    albums.then(list => { if (live) setFound({ track: track.id, album: albumFor(album, list) }); }, () => {});
    return () => { live = false; };
  }, [album, did, track.id]);
  return found?.track === track.id ? found.album : null;
}

export function useAlbumId(track: Track): string | null {
  return useAlbum(track)?.id ?? null;
}
