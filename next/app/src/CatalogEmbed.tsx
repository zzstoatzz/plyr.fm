import { trackArtwork, collectionArtwork } from './artwork';
import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef } from 'react';
import { View } from 'react-native';
import { api, trackIdFromUri, type Track } from './api';
import { artistName, Cover, Heading, Status, TrackRows, useResource } from './CatalogPieces';
import { Action, Copy } from './controls';
import { WaveLoading } from './WaveLoading';
import { TrackEmbed } from './TrackEmbed';
import { useAppearance } from './appearance';
import { usePlayback } from './playback';

type Kind = 'track' | 'artist' | 'playlist' | 'album';
interface EmbedData {
  title: string;
  subtitle?: string;
  artwork?: string | null;
  tracks: Track[];
}

async function legacy<T>(path: string): Promise<T> {
  const response = await fetch(`https://api.plyr.fm/${path}`);
  if (!response.ok) throw new Error('embed not found');
  return response.json() as Promise<T>;
}

async function legacyTracks(entries: { atproto_record_uri?: string }[]) {
  const results = await Promise.allSettled(entries.map(async entry => {
    if (!entry.atproto_record_uri) throw new Error('track has no record');
    return api.track(trackIdFromUri(entry.atproto_record_uri));
  }));
  return results.flatMap(result => result.status === 'fulfilled' ? [result.value] : []);
}

async function loadEmbed(kind: Kind, id: string, handle: string, slug: string): Promise<EmbedData> {
  if (kind === 'track') {
    const resolved = /^\d+$/.test(id)
      ? trackIdFromUri((await legacy<{ atproto_record_uri: string }>(`tracks/${id}`)).atproto_record_uri)
      : id;
    const track = await api.track(resolved);
    return { title: track.metadata.title, subtitle: artistName(track), artwork: trackArtwork(track), tracks: [track] };
  }
  if (kind === 'artist') {
    const artist = await api.artist(handle);
    const tracks = await api.tracks({ artist_did: artist.did, limit: 10 });
    return { title: artist.display_name || artist.handle, artwork: artist.avatar_url, tracks: tracks.data };
  }
  if (kind === 'album' && slug) {
    const album = await legacy<{ metadata: { title: string; artist_handle: string; image_url?: string }; tracks: { atproto_record_uri?: string }[] }>(
      `albums/${encodeURIComponent(handle)}/${encodeURIComponent(slug)}`
    );
    return { title: album.metadata.title, subtitle: album.metadata.artist_handle, artwork: album.metadata.image_url, tracks: await legacyTracks(album.tracks) };
  }
  if (kind === 'playlist' && !id.startsWith('pls_')) {
    const playlist = await legacy<{ name: string; owner_handle: string; image_url?: string; tracks: { atproto_record_uri?: string }[] }>(
      `lists/playlists/${encodeURIComponent(id)}`
    );
    return { title: playlist.name, subtitle: playlist.owner_handle, artwork: playlist.image_url, tracks: await legacyTracks(playlist.tracks) };
  }
  const list = await (kind === 'album' ? api.album(id) : api.playlist(id));
  return {
    title: list.metadata.name ?? (kind === 'album' ? 'album' : 'playlist'),
    subtitle: list.owner.profile?.display_name,
    artwork: collectionArtwork(list),
    tracks: list.members.flatMap(member => member.track ? [member.track] : []),
  };
}

export function CatalogEmbed({ kind }: { kind: Kind }) {
  const { id = '', handle = '', slug = '', autoplay } = useLocalSearchParams<{ id?: string; handle?: string; slug?: string; autoplay?: string }>();
  const load = useCallback(() => loadEmbed(kind, id, handle || id, slug), [kind, id, handle, slug]);
  const result = useResource(load);
  const player = usePlayback();
  const theme = useAppearance();
  const attempted = useRef(false);
  const data = result.data;
  const first = data?.tracks[0];
  const adult = [first?.moderation?.self_labels, first?.moderation?.operator_labels]
    .some(labels => labels?.some(label => label === 'sexual' || label === 'porn'));

  useEffect(() => {
    if (kind !== 'track' || autoplay !== '1' || !first || attempted.current) return;
    attempted.current = true;
    if (!adult && first.access.visibility === 'public') player.play(first);
  }, [adult, autoplay, first, kind, player]);

  if (!data && kind === 'track' && !result.error) return <View style={{ height: '100%', justifyContent: 'center' }}><WaveLoading label="Loading track" /></View>;
  if (!data) return <Status loading={!result.error} error={result.error} retry={result.retry} />;
  if (kind === 'track' && first) return <TrackEmbed key={first.id} track={first} adult={adult} />;
  return <View style={{ padding: 12, gap: 12, backgroundColor: theme.background }}>
    <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
      <Cover uri={adult ? null : data.artwork} round={kind === 'artist'} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Heading>{data.title}</Heading>
        {data.subtitle && <Copy>{data.subtitle}</Copy>}
      </View>

    </View>
    {kind !== 'track' && player.current && <Action label={player.status.playing ? 'Pause' : 'Resume'} onPress={player.toggle} />}
    {kind !== 'track' && <TrackRows tracks={data.tracks} onPlay={player.play} />}
    {(player.error || player.status.error) && <Copy>couldn’t play this track.</Copy>}
  </View>;
}
