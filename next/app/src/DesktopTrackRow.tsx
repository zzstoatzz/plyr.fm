import { Link } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { Track } from './api';
import { useAppearance } from './appearance';
import { trackArtwork } from './artwork';
import { artistName, Cover, type Play } from './CatalogPieces';
import { compactCount, formatDuration, timeAgo } from './home-state';
import { HomeTrackActions } from './HomeTrackRow';
import { LikersCount } from './Likers';
import { QueueButton, SignedOutHeart } from './RowActions';
import { Text } from './Text';
import { LikeButton, type Viewer } from './TrackLikes';
import { useAuth } from './auth';
import { Play as PlayIcon } from './icons';

/** A track as one line of a wide list: cover, then title, artist and a quiet line of plays, likes and when; queue, like and
 *  the menu show on hover or focus, and the length sits at the right edge. */
export function DesktopTrackRow({ track, tracks, onPlay, rank, now, returnTo = '/' }: { track: Track; tracks: Track[]; onPlay: Play; rank?: number; now?: number; returnTo?: string }) {
  const theme = useAppearance();
  const auth = useAuth();
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [likersOpen, setLikersOpen] = useState(false);
  const [viewer, setViewer] = useState<Viewer>();
  const quiet = { color: theme.faint, fontFamily: theme.fontFamily, fontSize: 12.5 * theme.scale, fontVariant: ['tabular-nums' as const] };
  const likes = Math.max(0, track.metrics.like_count + (viewer ? Number(viewer.liked) - Number(viewer.loaded) : 0));
  const plays = track.metrics.play_count;
  const age = now === undefined ? timeAgo(track.metadata.created_at, Date.now()) : timeAgo(track.metadata.created_at, now);
  const when = age === 'now' ? 'just now' : /^\d+[mhd]$/.test(age) ? `${age} ago` : age;
  const actions = hovered || focused;
  return <View testID="home-track-row" onPointerEnter={() => setHovered(true)} onPointerLeave={() => setHovered(false)}
    style={[styles.row, { backgroundColor: hovered ? theme.hover : 'transparent', zIndex: hovered || likersOpen ? 2 : 0 }]}>
    <Pressable testID="track-play-control" accessibilityRole="button" accessibilityLabel={`Play ${track.metadata.title}`} onPress={() => onPlay(track, tracks)} style={StyleSheet.absoluteFill} />
    {rank !== undefined && <Text pointerEvents="none" style={[quiet, styles.rank, { fontSize: 13.5 * theme.scale }]}>{rank}</Text>}
    <View pointerEvents="none"><Cover uri={trackArtwork(track)} size={52} radius={6} /></View>
    <View pointerEvents="box-none" style={styles.meta}>
      <Link href={`/track/${track.id}`} asChild><Pressable accessibilityRole="link" accessibilityLabel={`Track details: ${track.metadata.title}`} style={styles.link}>
        <Text numberOfLines={1} style={{ color: theme.text, fontFamily: theme.fontFamily, fontSize: 15 * theme.scale, fontWeight: '700' }}>{track.metadata.title}</Text>
      </Pressable></Link>
      <Link href={`/u/${encodeURIComponent(track.artist.profile.handle || track.artist.did)}`} asChild><Pressable accessibilityRole="link" style={styles.link}>
        <Text numberOfLines={1} style={{ color: theme.muted, fontFamily: theme.fontFamily, fontSize: 13.5 * theme.scale }}>{artistName(track)}</Text>
      </Pressable></Link>
      <View pointerEvents="box-none" style={styles.stats}>
        <View pointerEvents="none" accessibilityLabel={`${plays} ${plays === 1 ? 'play' : 'plays'}`} style={styles.stat}>
          <PlayIcon size={10 * theme.scale} weight="fill" color={theme.faint} /><Text style={quiet}>{compactCount(plays)}</Text>
        </View>
        <LikersCount track={track} count={likes} mine={viewer?.liked} onOpen={setLikersOpen} />
        {when ? <Text pointerEvents="none" numberOfLines={1} style={quiet}>{when}</Text> : null}
      </View>
    </View>
    <View onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} style={[styles.actions, { opacity: actions ? 1 : 0 }]}>
      <QueueButton track={track} shown={actions} />
      {auth.did && auth.rpc ? <LikeButton key={`${auth.did}:${track.record.uri}`} small track={track} reportLiked={setViewer} /> : <SignedOutHeart track={track} />}
      <HomeTrackActions track={track} returnTo={returnTo} />
    </View>
    <Text pointerEvents="none" style={[quiet, styles.time, { fontSize: 13.5 * theme.scale }]}>{formatDuration(track.metadata.duration_seconds)}</Text>
  </View>;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 76, paddingVertical: 8, paddingLeft: 10, paddingRight: 12, marginHorizontal: -10, borderRadius: 10 },
  rank: { width: 18, textAlign: 'right' },
  meta: { flex: 1, minWidth: 0, gap: 1 },
  link: { minHeight: 20, justifyContent: 'center', alignSelf: 'flex-start', maxWidth: '100%' },
  stats: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 22, marginTop: 1 },
  stat: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  time: { width: 52, textAlign: 'right' },
});
