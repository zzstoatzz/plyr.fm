export interface AtlasPoint {
  x: number; y: number; id: number; title: string; artist: string; handle: string; thumb: string;
  plays: number; likes: number; clusterCoarse: number; clusterFine: number; core: boolean;
}

export interface AtlasCluster {
  id: number; label: string; cx: number; cy: number; count: number; parent?: number;
  radius?: number; lantern?: { x: number; y: number; r: number } | null;
}

export interface AtlasArtist { did: string; handle: string; name: string; avatar: string; cx: number; cy: number; count: number }

export interface AtlasData {
  points: AtlasPoint[];
  clusters: { coarse: AtlasCluster[]; fine: AtlasCluster[] };
  artists: AtlasArtist[];
  meta: { generatedAt: string; nTracks: number };
}

export interface AtlasCallbacks {
  onHover: (point: AtlasPoint | null, sx: number, sy: number) => void;
  onHoverArtist: (artist: AtlasArtist | null, sx: number, sy: number) => void;
  onActivate: (point: AtlasPoint) => void;
  onActivateArtist: (artist: AtlasArtist) => void;
}

/** `preview` leaves plain wheel and one-finger drags to the page, for the map embedded on home. */
export interface AtlasOptions { dark: boolean; preview: boolean }
