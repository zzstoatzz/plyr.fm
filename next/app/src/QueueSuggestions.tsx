import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import type { Track } from '@plyr/next-core/api';
import { trackArtwork } from '@plyr/next-core/artwork';
import { loadStarter, starters, suggestionRequest, type Starter } from '@plyr/next-core/queue-suggestions';
import { api } from './api-client';
import { useAppearance } from './appearance';
import { useAuth } from './auth';
import { artistName, Cover } from './CatalogPieces';
import { ArrowClockwise, Check, Play, Plus } from './icons';
import { usePlayback } from './playback';
import { Text } from './Text';

const CARD = 118;
const GAP = 10;

/** Suggested tracks under a queue that has something in it: + adds one without reshuffling the row. */
export function QueueSuggestionStrips() {
  const player = usePlayback();
  const theme = useAppearance();
  const uri = player.current?.record.uri;
  const artistDid = player.current?.artist.did;
  const [round, setRound] = useState(0);
  const [picks, setPicks] = useState<Track[]>([]);
  const [more, setMore] = useState<{ name: string; tracks: Track[] }>({ name: '', tracks: [] });
  // An added card shrinks out of its strip (both strips, if it sits in both) instead of staying as a checkmark.
  const [leaving, setLeaving] = useState<Set<string>>(new Set());
  const [gone, setGone] = useState<Set<string>>(new Set());
  const shown = useRef<string[]>([]);
  const latest = useRef(player);
  latest.current = player;

  // Refetch when the playing track changes or on refresh, not on every queue edit.
  useEffect(() => {
    if (!uri) { setPicks([]); return; }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      const request = suggestionRequest(latest.current.queue, latest.current.index, round ? shown.current : []);
      if (!request) return;
      api.suggestions(request.seeds, { exclude: request.exclude, limit: 12, signal: controller.signal }).then(result => {
        setPicks(result.data);
        shown.current = [...result.data.map(track => track.record.uri), ...(round ? shown.current : [])].slice(0, 60);
      }, () => {});
    }, 300);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [uri, round]);

  useEffect(() => {
    const current = latest.current.current;
    if (!artistDid || !current) { setMore({ name: '', tracks: [] }); return; }
    const controller = new AbortController();
    api.tracks({ artist_did: artistDid, limit: 13 }, controller.signal).then(result => {
      const queued = new Set(latest.current.queue.map(track => track.id));
      setMore({ name: artistName(current), tracks: result.data.filter(track => !queued.has(track.id)).slice(0, 12) });
    }, () => {});
    return () => controller.abort();
  }, [artistDid]);

  const add = (track: Track) => { player.enqueue(track, true); setLeaving(previous => new Set([...previous, track.id])); };
  const leave = (id: string) => setGone(previous => previous.has(id) ? previous : new Set([...previous, id]));
  const shownPicks = picks.filter(track => !gone.has(track.id));
  const shownMore = more.tracks.filter(track => !gone.has(track.id));

  return <>
    {shownPicks.length > 0 && <View style={styles.section}>
      <View style={styles.head}>
        <Text accessibilityRole="header" style={[styles.heading, { color: theme.muted, fontFamily: theme.fontFamily, fontSize: 14 * theme.scale }]}>add to your queue</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Show other suggestions" onPress={() => setRound(value => value + 1)} hitSlop={4}
          style={({ pressed }) => [styles.icon, { opacity: pressed ? 0.6 : 1 }]}>
          <ArrowClockwise size={18} color={theme.muted} />
        </Pressable>
      </View>
      <Strip tracks={shownPicks} leaving={leaving} add={add} leave={leave} />
    </View>}
    {more.tracks.length > 1 && shownMore.length > 0 && <View style={styles.section}>
      <Text accessibilityRole="header" numberOfLines={1} style={[styles.heading, { color: theme.muted, fontFamily: theme.fontFamily, fontSize: 14 * theme.scale, paddingVertical: 10 }]}>more from {more.name}</Text>
      <Strip tracks={shownMore} leaving={leaving} add={add} leave={leave} />
    </View>}
  </>;
}

function Strip({ tracks, leaving, add, leave }: { tracks: Track[]; leaving: Set<string>; add: (track: Track) => void; leave: (id: string) => void }) {
  return <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -20 }} contentContainerStyle={{ paddingHorizontal: 20, gap: GAP }}
    snapToInterval={CARD + GAP} decelerationRate="fast">
    {tracks.map(track => <SuggestionCard key={track.id} track={track} leaving={leaving.has(track.id)} add={add} leave={leave} />)}
  </ScrollView>;
}

function SuggestionCard({ track, leaving, add, leave }: { track: Track; leaving: boolean; add: (track: Track) => void; leave: (id: string) => void }) {
  const theme = useAppearance();
  const reduceMotion = theme.reduceMotion;
  const life = useRef(new Animated.Value(1)).current;
  const latest = useRef(leave);
  latest.current = leave;
  useEffect(() => {
    if (!leaving) return;
    if (reduceMotion) { latest.current(track.id); return; }
    // the card shrinks away and its neighbours close the gap it leaves
    Animated.timing(life, { toValue: 0, duration: 240, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start(() => latest.current(track.id));
  }, [leaving, reduceMotion, life, track.id]);
  const title = track.metadata.title;
  return <Animated.View pointerEvents={leaving ? 'none' : 'auto'} style={{ width: life.interpolate({ inputRange: [0, 1], outputRange: [0, CARD] }), marginRight: life.interpolate({ inputRange: [0, 1], outputRange: [-GAP, 0] }),
    opacity: life, transform: [{ scale: life.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1] }) }], overflow: 'hidden' }}>
    <View style={{ width: CARD, gap: 2 }}>
      <Pressable accessibilityRole="link" accessibilityLabel={`${title} by ${artistName(track)}`} onPress={() => router.push({ pathname: '/track/[id]', params: { id: track.id } })}>
        <Cover uri={trackArtwork(track)} size={CARD} radius={10} />
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={`Add ${title} to queue`} disabled={leaving}
        onPress={() => add(track)} hitSlop={6}
        style={({ pressed }) => [styles.plus, { top: CARD - 42, backgroundColor: theme.surface, opacity: pressed ? 0.7 : 1 }]}>
        <Plus size={16} color={theme.text} weight="bold" />
      </Pressable>
      <Text numberOfLines={1} style={{ marginTop: 4, color: theme.text, fontFamily: theme.fontFamily, fontSize: 14 * theme.scale, fontWeight: '600' }}>{title}</Text>
      <Text numberOfLines={1} style={{ color: theme.muted, fontFamily: theme.fontFamily, fontSize: 12.5 * theme.scale }}>{artistName(track)}</Text>
    </View>
  </Animated.View>;
}

type Loaded = { tracks: Track[]; label: string } | 'loading' | 'failed';

/** The empty queue: ready-made stacks with real covers, added (or played) in one tap. */
export function QueueStarters() {
  const player = usePlayback();
  const theme = useAppearance();
  const { did } = useAuth();
  const offered = starters(!!did);
  const [stacks, setStacks] = useState<Record<string, Loaded>>({});
  const [started, setStarted] = useState<Set<string>>(new Set());
  const pending = useRef<Record<string, number>>({});

  const load = (starter: Starter) => {
    const attempt = pending.current[starter.key] = (pending.current[starter.key] ?? 0) + 1;
    const settle = (value: Loaded) => { if (pending.current[starter.key] === attempt) setStacks(previous => ({ ...previous, [starter.key]: value })); };
    settle('loading');
    loadStarter(api, starter.key, did ?? undefined).then(settle, () => settle('failed'));
  };
  useEffect(() => {
    for (const key in pending.current) pending.current[key]++;
    setStacks({}); setStarted(new Set());
    for (const starter of offered) load(starter);
  }, [did]); // eslint-disable-line react-hooks/exhaustive-deps

  const start = (starter: Starter) => {
    const stack = stacks[starter.key];
    if (typeof stack !== 'object' || !stack.tracks.length) return;
    if (player.current) player.enqueueAll(stack.tracks, stack.label);
    else player.play(stack.tracks[0], stack.tracks, stack.label);
    setStarted(previous => new Set([...previous, starter.key]));
  };

  const surface = { backgroundColor: theme.surface, borderColor: theme.border };
  return <View style={{ gap: 12 }}>
    <View style={[styles.note, surface]}>
      <Text accessibilityRole="header" style={{ color: theme.text, fontFamily: theme.fontFamily, fontSize: 17 * theme.scale, fontWeight: '700' }}>nothing up next</Text>
      <Text style={{ color: theme.muted, fontFamily: theme.fontFamily, fontSize: 14 * theme.scale }}>{player.current ? 'add a stack and it plays after this one.' : 'pick a stack to start listening.'}</Text>
    </View>
    <View style={styles.tiles}>
      {offered.map((starter, index) => {
        const stack = stacks[starter.key];
        if (stack === 'failed' || (typeof stack === 'object' && !stack.tracks.length)) return null;
        const ready = typeof stack === 'object';
        const big = index === 0;
        const label = `${player.current ? 'Add' : 'Play'} ${starter.title}`;
        const done = started.has(starter.key);
        const covers = ready ? stack.tracks.slice(0, 4) : [];
        return <View key={starter.key} style={[styles.tile, surface, big ? { width: '100%' } : { flexBasis: 0, flexGrow: 1 }]}>
          <Pressable accessible={false} importantForAccessibility="no-hide-descendants" disabled={!ready} onPress={() => start(starter)}
            style={({ pressed }) => [styles.stack, { backgroundColor: theme.raised, opacity: pressed ? 0.8 : 1 }, big ? null : { flexWrap: 'wrap' }]}>
            {[0, 1, 2, 3].map(at => <View key={at} style={big ? { flex: 1, aspectRatio: 1 } : { width: '50%', aspectRatio: 1 }}>
              {covers[at] ? <Cover uri={trackArtwork(covers[at])} size={big ? 90 : 70} radius={0} instant /> : null}
            </View>)}
          </Pressable>
          <View style={styles.tileRow}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={1} style={{ color: theme.text, fontFamily: theme.fontFamily, fontSize: 15 * theme.scale, fontWeight: '700' }}>
                {starter.key === 'playlist' && ready ? stack.label : starter.title}</Text>
              {big && <Text numberOfLines={1} style={{ color: theme.muted, fontFamily: theme.fontFamily, fontSize: 12.5 * theme.scale }}>{starter.subtitle}</Text>}
            </View>
            {starter.key === 'playlist' && <Pressable accessibilityRole="button" accessibilityLabel="Pick another playlist" onPress={() => load(starter)} hitSlop={4} style={styles.icon}>
              <ArrowClockwise size={16} color={theme.muted} />
            </Pressable>}
            <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={!ready} onPress={() => start(starter)} hitSlop={6}
              style={({ pressed }) => [styles.round, { borderColor: done ? theme.accent : theme.border, backgroundColor: done ? theme.accent : 'transparent', opacity: !ready ? 0.4 : pressed ? 0.7 : 1 }]}>
              {done ? <Check size={16} color={theme.onAccent} weight="bold" /> : player.current ? <Plus size={16} color={theme.text} weight="bold" /> : <Play size={14} color={theme.text} weight="fill" />}
            </Pressable>
          </View>
        </View>;
      })}
    </View>
  </View>;
}

const styles = StyleSheet.create({
  section: { gap: 2 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  heading: { fontWeight: '600' },
  icon: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  plus: { position: 'absolute', right: 6, width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', boxShadow: '0px 4px 10px #00000047' },
  note: { padding: 14, gap: 3, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tile: { padding: 10, gap: 8, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth },
  stack: { flexDirection: 'row', borderRadius: 10, overflow: 'hidden' },
  tileRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  round: { width: 36, height: 36, borderRadius: 18, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' }
});
