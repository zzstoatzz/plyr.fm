import { Catalog, type CatalogScreen } from './Catalog';
import { usePlayback } from './playback';

function catalogRoute(screen: CatalogScreen) {
  return function CatalogRoute() {
    const { play, enqueue } = usePlayback();
    return <Catalog screen={screen} onPlay={play} onEnqueue={enqueue} />;
  };
}

export const HomeRoute = catalogRoute('home');
export const SearchRoute = catalogRoute('search');
export const PlaylistsRoute = catalogRoute('playlists');
export const TrackRoute = catalogRoute('track');
export const AlbumRoute = catalogRoute('album');
export const PlaylistRoute = catalogRoute('playlist');
export const ArtistRoute = catalogRoute('artist');
export const LibraryRoute = catalogRoute('library');
export const LikedRoute = catalogRoute('liked');
