import type { Href } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, CaretDown, CaretRight as ChevronRight, CaretUp, Equalizer, Play } from './icons';
import { Pressable, StyleSheet, View, type ViewInstance, type ViewProps } from 'react-native';
import type { Track } from './api';
import { isPrivateTrack } from './publishing/private-track';
import { useAppearance } from './appearance';
import { Cover, artistName } from './CatalogPieces';
import { Text } from './Text';
import { AccessSummary } from './access/AccessSummary';
import { clock, currentChapter, parseChapters, type Chapter } from './chapters';
import { compactCount } from './home-state';
import { firstLikers } from './Likers';
import { Sheet, type Anchor } from './Sheet';
import { People } from './TrackLikes';

const SHOWN = 7;

export function NowPlayingDetails({ track, plays, protect, navigate, wide, position, seek }: {
  track: Track; plays: number; protect: ViewProps; navigate: (target: Href) => void; wide: boolean; position: number; seek?: (seconds: number) => void;
}) {
  const theme = useAppearance();
  const body = { color: theme.text, fontFamily: theme.fontFamily, fontSize: 15 * theme.scale, lineHeight: 22 * theme.scale } as const;
  const quiet = { color: theme.muted, fontFamily: theme.fontFamily, fontSize: 14 * theme.scale, lineHeight: 20 * theme.scale } as const;
  const { profile } = track.artist;
  const privateTrack = isPrivateTrack(track);
  const duration = track.metadata.duration_seconds || 0;
  const { chapters, prose } = useMemo(() => parseChapters(track.metadata.description, duration), [track.metadata.description, duration]);

  return <View>
    {!wide && <View testID="now-playing-artist" style={[styles.section, { borderColor: theme.line }]}>
      <View {...protect}>
        <Pressable accessibilityRole="link" accessibilityLabel={`Artist: ${artistName(track)}`}
          onPress={() => navigate(`/u/${encodeURIComponent(profile.handle || track.artist.did)}`)}
          style={({ pressed }) => [styles.artist, { backgroundColor: pressed ? theme.hover : 'transparent' }]}>
          <Cover uri={profile.avatar_url} size={56} round />
          <View style={styles.text}>
            <Text numberOfLines={1} style={{ ...body, fontSize: 17 * theme.scale, fontWeight: '700' }}>{profile.display_name || profile.handle}</Text>
            {!!profile.handle && <Text numberOfLines={1} style={quiet}>@{profile.handle}</Text>}
          </View>
          <ChevronRight size={20} color={theme.muted} />
        </Pressable>
      </View>
      {profile.bio ? <Text numberOfLines={4} style={{ ...body, color: theme.muted }}>{profile.bio}</Text> : null}
    </View>}
    <View testID="now-playing-about" style={[styles.about, { borderColor: wide ? theme.hairline : theme.line }]}>
      {!privateTrack && <Facts track={track} plays={plays} protect={protect} />}
      {prose ? <Text style={body}>{prose}</Text> : null}
      {track.metadata.album ? <Text style={quiet}>from <Text style={{ ...quiet, color: theme.text, fontWeight: '600' }}>{track.metadata.album}</Text></Text> : null}
      <AccessSummary track={track} style={quiet} />
      {(chapters.length > 0 || !privateTrack) && <View style={styles.heading}>
        {chapters.length > 0 ? <Text accessibilityRole="header" aria-level={2} style={{ ...body, fontWeight: '700' }}>tracklist <Text style={{ ...body, color: theme.faint }}>{chapters.length}</Text></Text> : <View />}
        {!privateTrack && <View {...protect}>
          <Pressable accessibilityRole="button" accessibilityLabel="Open track page" onPress={() => navigate(`/track/${track.id}`)} style={styles.link}>
            {({ hovered }: { pressed: boolean; hovered?: boolean }) => <>
              <Text style={{ ...quiet, color: hovered ? theme.text : theme.muted }}>track page</Text>
              <ArrowRight size={14} color={hovered ? theme.text : theme.muted} />
            </>}
          </Pressable>
        </View>}
      </View>}
      {chapters.length > 0 && <Chapters chapters={chapters} position={position} seek={seek} protect={protect} />}
    </View>
  </View>;
}

/** Plays, likes (with who), when it was added and how long it runs, labelled like the columns of a track list. */
function Facts({ track, plays, protect }: { track: Track; plays: number; protect: ViewProps }) {
  const theme = useAppearance();
  const likes = track.metrics.like_count;
  const added = new Date(track.metadata.created_at);
  const label = { color: theme.faint, fontSize: 11.5 * theme.scale, fontWeight: '700', letterSpacing: 0.7, textTransform: 'uppercase' } as const;
  const value = { color: theme.text, fontFamily: theme.fontFamily, fontSize: 16 * theme.scale, fontWeight: '700', fontVariant: ['tabular-nums'] } as const;
  const sameYear = added.getFullYear() === new Date().getFullYear();
  const date = Number.isNaN(added.getTime()) ? '' : added.toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) }).toLowerCase();
  const facts = [
    { label: 'plays', value: <Text accessibilityLabel={`${plays} ${plays === 1 ? 'play' : 'plays'}`} style={value}>{compactCount(plays)}</Text> },
    { label: 'likes', value: <Likers track={track} count={likes} style={value} protect={protect} /> },
    ...date ? [{ label: 'added', value: <Text style={value}>{date}</Text> }] : [],
    ...track.metadata.duration_seconds ? [{ label: 'length', value: <Text style={value}>{clock(track.metadata.duration_seconds)}</Text> }] : [],
  ];
  return <View testID="now-playing-facts" style={[styles.facts, { borderColor: theme.hairline }]}>
    {facts.map(fact => <View key={fact.label} style={styles.fact}>
      <Text aria-hidden style={label}>{fact.label}</Text>
      {fact.value}
    </View>)}
  </View>;
}

function Likers({ track, count, style, protect }: { track: Track; count: number; style: object; protect: ViewProps }) {
  const theme = useAppearance();
  const [faces, setFaces] = useState<{ did: string; avatar?: string | null }[]>([]);
  const [open, setOpen] = useState<Anchor>();
  const cell = useRef<ViewInstance>(null);
  useEffect(() => {
    setFaces([]);
    if (!count) return;
    let live = true;
    firstLikers(track.id, count).then(people => { if (live) setFaces(people.slice(0, 3)); }, () => {});
    return () => { live = false; };
  }, [track.id, count]);
  if (!count) return <Text style={style}>0</Text>;
  return <View ref={cell} {...protect}>
    <Pressable accessibilityRole="button" accessibilityLabel={`See who liked ${track.metadata.title}, ${count} ${count === 1 ? 'like' : 'likes'}`}
      onPress={() => cell.current?.measureInWindow((x, y, width, height) => setOpen({ x, y, width, height }))} style={styles.likers}>
      {({ hovered }: { pressed: boolean; hovered?: boolean }) => <>
        <Text style={[style, hovered ? { textDecorationLine: 'underline' } : null]}>{compactCount(count)}</Text>
        {faces.length > 0 && <View style={styles.faces}>{faces.map((face, index) =>
          <View key={face.did} style={[styles.face, { marginLeft: index ? -6 : 0, borderColor: theme.background }]}><Cover uri={face.avatar} size={18} round instant /></View>)}</View>}
      </>}
    </Pressable>
    {open && <Sheet title="liked by" anchor={open} close={() => setOpen(undefined)}><People id={track.id} close={() => setOpen(undefined)} /></Sheet>}
  </View>;
}

/** A tracklist read from the description. Each line jumps there; the playing one is marked. */
function Chapters({ chapters, position, seek, protect }: { chapters: Chapter[]; position: number; seek?: (seconds: number) => void; protect: ViewProps }) {
  const theme = useAppearance();
  const [all, setAll] = useState(false);
  const now = currentChapter(chapters, position);
  const shown = all || chapters.length <= SHOWN + 1 ? chapters : chapters.slice(0, Math.max(SHOWN, now + 1));
  const text = { fontFamily: theme.fontFamily, fontSize: 14 * theme.scale } as const;
  const stamp = (chapters[chapters.length - 1].start >= 3600 ? 52 : 38) * theme.scale;
  return <View testID="now-playing-chapters" style={styles.chapters}>
    {shown.map((chapter, index) => {
      const current = index === now;
      return <View key={chapter.start} {...protect}><Pressable accessibilityRole="button" accessibilityLabel={`Jump to ${clock(chapter.start)}, ${chapter.label}`}
        aria-current={current ? 'true' : undefined} disabled={!seek} onPress={() => seek?.(chapter.start)}
        style={({ hovered }: { pressed: boolean; hovered?: boolean }) => [styles.chapter, { backgroundColor: current ? theme.accent + '1f' : hovered && seek ? theme.hover : 'transparent' }]}>
        {({ hovered }: { pressed: boolean; hovered?: boolean }) => <>
          <Text style={[text, styles.stamp, { width: stamp, color: current ? theme.accent : theme.faint, fontSize: 13 * theme.scale }]}>{clock(chapter.start)}</Text>
          <Text numberOfLines={1} style={[text, { flex: 1, color: current ? theme.accent : theme.text, fontWeight: '600' }]}>
            {chapter.title}{chapter.artist ? <Text style={[text, { color: theme.muted, fontWeight: '400' }]}> · {chapter.artist}</Text> : null}
          </Text>
          {current ? <Equalizer size={16} color={theme.accent} /> : hovered && seek ? <Play size={14} weight="fill" color={theme.muted} /> : null}
        </>}
      </Pressable></View>;
    })}
    {shown.length < chapters.length || all ? <View {...protect} style={{ alignSelf: 'flex-start' }}>
      <Pressable accessibilityRole="button" onPress={() => setAll(!all)} style={styles.link}>
        <Text style={{ ...text, color: theme.muted }}>{all ? 'show less' : `show all ${chapters.length}`}</Text>
        {all ? <CaretUp size={14} color={theme.muted} /> : <CaretDown size={14} color={theme.muted} />}
      </Pressable>
    </View> : null}
  </View>;
}

const styles = StyleSheet.create({
  section: { paddingVertical: 20, gap: 12, borderTopWidth: StyleSheet.hairlineWidth },
  about: { paddingVertical: 4, gap: 14 },
  artist: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 64, borderRadius: 10, marginHorizontal: -6, paddingHorizontal: 6 },
  text: { flex: 1, minWidth: 0, gap: 2 },
  facts: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 14, borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth },
  fact: { gap: 4 },
  likers: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 24 },
  faces: { flexDirection: 'row' },
  face: { borderWidth: 2, borderRadius: 11 },
  heading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 32 },
  link: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 44, minWidth: 44 },
  chapters: { marginTop: -10 },
  chapter: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 36, paddingHorizontal: 8, marginHorizontal: -8, borderRadius: 8 },
  stamp: { textAlign: 'right', fontVariant: ['tabular-nums'] },
});
