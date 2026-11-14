import { useEffect, useState } from 'react';
import { api, type ListSummary, type Track } from './api';

const byArtist = new Map<string, Promise<ListSummary[]>>();

/** A track names its album by title only; the artist's album with that name, if one exists. */
export function albumFor(name: string | null, albums: ListSummary[]): ListSummary | null {
  const wanted = name?.trim().toLowerCase();
  if (!wanted) return null;
  return albums.find(album => album.metadata.name?.trim().toLowerCase() === wanted) ?? null;
}

export function useAlbumId(track: Track): string | null {
  const [found, setFound] = useState<{ track: string; id: string | null } | null>(null);
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
    albums.then(list => { if (live) setFound({ track: track.id, id: albumFor(album, list)?.id ?? null }); }, () => {});
    return () => { live = false; };
  }, [album, did, track.id]);
  return found?.track === track.id ? found.id : null;
}
