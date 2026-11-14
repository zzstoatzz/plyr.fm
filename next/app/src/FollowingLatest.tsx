import { Link } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { api, type Track } from './api';
import { useAppearance } from './appearance';
import { trackArtwork } from './artwork';
import { Cover, type Play } from './CatalogPieces';
import type { NetworkArtist } from './home-api';
import { formatDuration, timeAgo } from './home-state';
import { Equalizer, Play as PlayIcon, Shuffle } from './icons';
import { usePlayback } from './playback';
import { cardSurface } from './materials';
import { Text } from './Text';

const MOST = 12;
const newest = new Map<string, Promise<Track | undefined>>();

function latestBy(did: string) {
  let load = newest.get(did);
  if (!load) {
    load = api.tracks({ artist_did: did, limit: 1 }).then(page => page.data[0], () => { newest.delete(did); return undefined; });
    newest.set(did, load);
  }
  return load;
}

/** The newest track from each artist you follow, newest first. Artists whose track can't be loaded are left out. */
export function useFollowingLatest(artists: NetworkArtist[]) {
  const [tracks, setTracks] = useState<{ key: string; data: Track[] }>({ key: '', data: [] });
  const key = artists.slice(0, MOST).map(artist => artist.did).join(',');
  useEffect(() => {
    if (!key) return;
    let live = true;
    void Promise.all(key.split(',').map(latestBy)).then(found => {
      if (!live) return;
      const data = found.filter((track): track is Track => !!track)
        .sort((a, b) => Date.parse(b.metadata.created_at) - Date.parse(a.metadata.created_at));
      setTracks({ key, data });
    });
    return () => { live = false; };
  }, [key]);
  return { tracks: tracks.key === key ? tracks.data : [], loading: !!key && tracks.key !== key };
}

const name = (track: Track) => track.artist.profile.display_name || track.artist.profile.handle;

export function PlayOneFromEach({ tracks, onPlay }: { tracks: Track[]; onPlay: Play }) {
  const theme = useAppearance();
  if (tracks.length < 2) return null;
  return <Pressable accessibilityRole="button" accessibilityLabel={`Play one track from each of ${tracks.length} people you follow`}
    onPress={() => onPlay(tracks[0], tracks, 'new from people you follow')} style={styles.each}>
    {({ hovered }: { pressed: boolean; hovered?: boolean }) => <>
      <Shuffle size={16} color={hovered ? theme.text : theme.muted} />
      <Text style={{ color: hovered ? theme.text : theme.muted, fontSize: 13.5 * theme.scale, fontWeight: '600' }}>play one from each</Text>
    </>}
  </Pressable>;
}

/** One person's newest track: the cover with their face on its corner, who posted it and when, and a play button. */
export function FollowingTrack({ track, tracks, onPlay, now, width }: { track: Track; tracks: Track[]; onPlay: Play; now: number; width?: number }) {
  const theme = useAppearance();
  const player = usePlayback();
  const current = player.current?.id === track.id;
  const playing = current && player.status.playing;
  const who = name(track);
  const profile = { pathname: '/u/[handle]' as const, params: { handle: track.artist.profile.handle || track.artist.did } };
  return <View testID="following-track" style={[cardSurface(theme), styles.card, width ? { width } : undefined]}>
    <Link href={profile} asChild><Pressable accessibilityRole="link" accessibilityLabel={who} style={styles.art}>
      <Cover uri={trackArtwork(track) || track.artist.profile.avatar_url} size={56} radius={8} />
      <View style={[styles.face, { borderColor: theme.surface }]}><Cover uri={track.artist.profile.avatar_url} size={22} round instant /></View>
    </Pressable></Link>
    <View style={styles.text}>
      <Text numberOfLines={1} style={{ color: theme.faint, fontSize: 12.5 * theme.scale }}><Text style={{ color: theme.muted, fontWeight: '600' }}>{who}</Text> posted</Text>
      <Text numberOfLines={1} style={{ color: current ? theme.accent : theme.text, fontFamily: theme.fontFamily, fontSize: 14 * theme.scale, fontWeight: '600' }}>{track.metadata.title}</Text>
      <Text numberOfLines={1} style={{ color: theme.faint, fontSize: 12.5 * theme.scale, fontVariant: ['tabular-nums'] }}>
        {[timeAgo(track.metadata.created_at, now), formatDuration(track.metadata.duration_seconds)].filter(Boolean).join(' · ')}
      </Text>
    </View>
    <Pressable accessibilityRole="button" accessibilityLabel={`${playing ? 'Pause' : current ? 'Resume' : 'Play'} ${track.metadata.title} by ${who}`}
      onPress={() => current ? player.setPlaying(!player.status.playing) : onPlay(track, tracks, 'new from people you follow')}
      style={[styles.play, { backgroundColor: current ? theme.accent : theme.raised }]}>
      {playing ? <Equalizer size={16} color={theme.onAccent} /> : <PlayIcon size={15} color={current ? theme.onAccent : theme.text} fill={current ? theme.onAccent : theme.text} />}
    </Pressable>
  </View>;
}

const styles = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10, borderRadius: 14 },
  art: { width: 62, height: 62, justifyContent: 'center' },
  face: { position: 'absolute', right: -2, bottom: -2, borderWidth: 2, borderRadius: 13, overflow: 'hidden' },
  text: { flex: 1, minWidth: 0, gap: 1 },
  play: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  each: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44, paddingHorizontal: 4 },
});
