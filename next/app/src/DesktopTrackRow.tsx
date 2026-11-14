import { Link } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { Track } from './api';
import { useAppearance } from './appearance';
import { trackArtwork } from './artwork';
import { artistName, Cover, type Play } from './CatalogPieces';
import { compactCount, formatDuration, timeAgo } from './home-state';
import { HomeTrackActions } from './HomeTrackRow';
import { LikesCell, QueueButton } from './RowActions';
import { Text } from './Text';
import type { Viewer } from './TrackLikes';

const COLUMNS = { queue: 40, plays: 64, likes: 84, time: 58, menu: 44 };

/** Labels for the number columns of `DesktopTrackRow`, so the numbers need no icons. */
export function DesktopTrackHeader({ rank = false }: { rank?: boolean }) {
  const theme = useAppearance();
  const label = { color: theme.faint, fontSize: 11.5 * theme.scale, fontWeight: '700' as const, letterSpacing: 0.7, textTransform: 'uppercase' as const };
  return <View aria-hidden style={[styles.header, { borderBottomColor: theme.hairline }]}>
    {rank && <View style={styles.rank} />}
    <Text style={[label, { flex: 1, paddingLeft: 62 }]}>title</Text>
    <View style={{ width: COLUMNS.queue }} />
    <Text style={[label, styles.right, { width: COLUMNS.plays }]}>plays</Text>
    <Text style={[label, { width: COLUMNS.likes, paddingLeft: 36 }]}>likes</Text>
    <Text style={[label, styles.right, { width: COLUMNS.time }]}>time</Text>
    <View style={{ width: COLUMNS.menu }} />
  </View>;
}

/** A track as one line of a wide list: cover, title, artist and age, then plays, the heart with its count, and length in labelled columns. */
export function DesktopTrackRow({ track, tracks, onPlay, rank, now, returnTo = '/' }: { track: Track; tracks: Track[]; onPlay: Play; rank?: number; now?: number; returnTo?: string }) {
  const theme = useAppearance();
  const [hovered, setHovered] = useState(false);
  const [viewer, setViewer] = useState<Viewer>();
  const number = { color: theme.muted, fontSize: 13.5 * theme.scale, fontVariant: ['tabular-nums' as const], textAlign: 'right' as const };
  const likes = Math.max(0, track.metrics.like_count + (viewer ? Number(viewer.liked) - Number(viewer.loaded) : 0));
  const age = now === undefined ? '' : timeAgo(track.metadata.created_at, now);
  const when = age === 'now' ? 'just now' : /^\d+[mhd]$/.test(age) ? `${age} ago` : age;
  return <View testID="home-track-row" onPointerEnter={() => setHovered(true)} onPointerLeave={() => setHovered(false)}
    style={[styles.row, { backgroundColor: hovered ? theme.hover : 'transparent', zIndex: hovered ? 2 : 0 }]}>
    <Pressable testID="track-play-control" accessibilityRole="button" accessibilityLabel={`Play ${track.metadata.title}`} onPress={() => onPlay(track, tracks)} style={StyleSheet.absoluteFill} />
    {rank !== undefined && <Text pointerEvents="none" style={[number, styles.rank, { color: theme.faint }]}>{rank}</Text>}
    <View pointerEvents="none"><Cover uri={trackArtwork(track)} size={48} radius={6} /></View>
    <View pointerEvents="box-none" style={styles.meta}>
      <Link href={`/track/${track.id}`} asChild><Pressable accessibilityRole="link" accessibilityLabel={`Track details: ${track.metadata.title}`} style={styles.link}>
        <Text numberOfLines={1} style={{ color: theme.text, fontFamily: theme.fontFamily, fontSize: 15 * theme.scale, fontWeight: '600' }}>{track.metadata.title}</Text>
      </Pressable></Link>
      <View pointerEvents="box-none" style={styles.byline}>
        <Link href={`/u/${encodeURIComponent(track.artist.profile.handle || track.artist.did)}`} asChild><Pressable accessibilityRole="link" style={StyleSheet.flatten([styles.link, { flexShrink: 1 }])}>
          <Text numberOfLines={1} style={{ color: theme.muted, fontFamily: theme.fontFamily, fontSize: 13.5 * theme.scale }}>{artistName(track)}</Text>
        </Pressable></Link>
        {when ? <Text pointerEvents="none" numberOfLines={1} style={{ color: theme.faint, fontFamily: theme.fontFamily, fontSize: 13.5 * theme.scale }}>· {when}</Text> : null}
      </View>
    </View>
    <View style={{ width: COLUMNS.queue, alignItems: 'flex-end' }}><QueueButton track={track} shown={hovered} /></View>
    <Text pointerEvents="none" accessibilityLabel={`${track.metrics.play_count} ${track.metrics.play_count === 1 ? 'play' : 'plays'}`} style={[number, { width: COLUMNS.plays }]}>{compactCount(track.metrics.play_count)}</Text>
    <LikesCell track={track} count={likes} width={COLUMNS.likes} mine={viewer?.liked} onViewer={setViewer} />
    <Text pointerEvents="none" style={[number, { width: COLUMNS.time }]}>{formatDuration(track.metadata.duration_seconds)}</Text>
    <View style={{ width: COLUMNS.menu, alignItems: 'flex-end' }}><HomeTrackActions track={track} returnTo={returnTo} /></View>
  </View>;
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingLeft: 10, paddingRight: 2, marginHorizontal: -10, paddingBottom: 8, marginBottom: 4, borderBottomWidth: StyleSheet.hairlineWidth },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 64, paddingLeft: 10, paddingRight: 2, marginHorizontal: -10, borderRadius: 10 },
  rank: { width: 18, textAlign: 'right' },
  meta: { flex: 1, minWidth: 0 },
  byline: { flexDirection: 'row', alignItems: 'center', gap: 5, minWidth: 0 },
  link: { minHeight: 22, justifyContent: 'center', alignSelf: 'flex-start', maxWidth: '100%' },
  right: { textAlign: 'right' },
});
