import { useEffect, useState } from 'react';
import type { Artist, Track } from '@plyr/next-core/api';
import { offerFor, supportLink, type Offer } from '@plyr/next-core/selling';
import { sellers } from '../track-extras';
import { useAlbum } from '../use-album-id';

/** the artist's public profile, for their buy and support links. quiet on failure: selling is optional. */
export function useSeller(did: string | undefined): Artist | undefined {
  const [found, setFound] = useState<{ did: string; artist: Artist }>();
  useEffect(() => {
    if (!did) return;
    let live = true;
    sellers.load(did).then(artist => { if (live) setFound({ did, artist }); }, () => {});
    return () => { live = false; };
  }, [did]);
  if (!did) return undefined;
  return found?.did === did ? found.artist : sellers.peek(did);
}

/** where a listener can buy this track (its own link, else its album's) and support its artist */
export function useTrackSelling(track: Track): { offer?: Offer; support?: string } {
  const artist = useSeller(track.artist.did);
  const album = useAlbum(track);
  return { offer: offerFor(artist, [track.record.uri, album?.record.uri]), support: supportLink(artist) };
}
