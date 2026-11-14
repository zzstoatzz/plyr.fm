import { usePathname } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Animated, Platform, Pressable, StyleSheet, View, type ViewInstance } from 'react-native';
import { api, type Track } from './api';
import { useAppearance } from './appearance';
import { useAuth } from './auth';
import { Cover } from './CatalogPieces';
import { compactCount } from './home-state';
import { Heart, ListPlus } from './icons';
import { wantLike } from './like-interactions';
import { usePlayback } from './playback';
import { createPds } from './pds';
import { Sheet, type Anchor } from './Sheet';
import { readLocal, removeLocal, writeLocal } from './storage';
import { Text } from './Text';
import { toast } from './toast';
import { LikeButton, People, type Viewer } from './TrackLikes';

const pendingKey = 'plyr-next:pending-like';
const pendingFor = 30 * 60_000;

/** A heart and add-to-queue for a wide row. They show while the row is hovered or focused, and the heart stays while the track is liked. */
export function RowActions({ track, shown, onViewer }: { track: Track; shown: boolean; onViewer: (viewer: Viewer) => void }) {
  const auth = useAuth();
  const player = usePlayback();
  const theme = useAppearance();
  const [liked, setLiked] = useState(false);
  const [focused, setFocused] = useState(false);
  const report = (viewer: Viewer) => { setLiked(viewer.liked); onViewer(viewer); };
  const visible = shown || focused;
  return <View onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} style={styles.actions}>
    <View style={{ opacity: visible || liked ? 1 : 0 }}>
      {auth.did && auth.rpc ? <LikeButton key={`${auth.did}:${track.record.uri}`} small track={track} reportLiked={report} /> : <SignedOutHeart track={track} />}
    </View>
    <Pressable accessibilityRole="button" accessibilityLabel={`Add ${track.metadata.title} to queue`} onPress={() => { player.enqueue(track); toast.success(`queued ${track.metadata.title}`); }}
      style={({ hovered }: { pressed: boolean; hovered?: boolean }) => [styles.button, { opacity: visible ? 1 : 0, backgroundColor: hovered ? theme.raised : 'transparent' }]}>
      <ListPlus size={18} color={theme.muted} />
    </Pressable>
  </View>;
}

/** Signed out, the heart shakes its head and offers sign-in, which comes back here and finishes the like. */
function SignedOutHeart({ track }: { track: Track }) {
  const theme = useAppearance();
  const path = usePathname();
  const shake = useRef(new Animated.Value(0)).current;
  function nudge() {
    if (!theme.reduceMotion) {
      shake.setValue(0);
      Animated.sequence([-4, 4, -3, 3, 0].map(toValue => Animated.timing(shake, { toValue, duration: 100, useNativeDriver: Platform.OS !== 'web' }))).start();
    }
    writeLocal(pendingKey, JSON.stringify({ id: track.id, at: Date.now() }));
    toast.add('sign in to like tracks', 'info', 5000, { label: 'sign in', href: { pathname: '/login', params: { return_to: path } } }, 'sign-in-to-like');
  }
  return <Pressable accessibilityRole="button" accessibilityLabel={`Like ${track.metadata.title}`} accessibilityHint="Sign in to like tracks" onPress={nudge} style={styles.button}>
    <Animated.View style={{ transform: [{ translateX: shake }] }}><Heart size={18} color={theme.muted} /></Animated.View>
  </Pressable>;
}

/** After sign-in, likes the track a signed-out heart was tapped on, if that was in the last half hour. */
export function useFinishPendingLike() {
  const { did, rpc } = useAuth();
  useEffect(() => {
    if (!did || !rpc) return;
    const saved = readLocal(pendingKey);
    if (!saved) return;
    removeLocal(pendingKey);
    let pending: { id?: unknown; at?: unknown };
    try { pending = JSON.parse(saved); } catch { return; }
    if (typeof pending.id !== 'string' || typeof pending.at !== 'number' || Date.now() - pending.at > pendingFor) return;
    const pds = createPds({ did, rpc });
    void api.track(pending.id).then(async track => {
      const liked = (await pds.myLikes()).has(track.record.uri);
      if (liked) return;
      const outcome = await wantLike(rpc, track.record.uri, false, true, () => pds.like(track, { waitForIndex: false }));
      if (outcome?.failed) toast.error(`couldn't like ${track.metadata.title}`);
      else if (outcome?.changed) toast.success(`liked ${track.metadata.title}`);
    }, () => toast.error("couldn't finish that like"));
  }, [did, rpc]);
}

type Liker = { did: string; name: string; avatar?: string | null };
const likers = new Map<string, Promise<Liker[]>>();
function firstLikers(id: string) {
  let load = likers.get(id);
  if (!load) {
    load = api.trackLikes(id).then(page => page.data.map(({ actor }) => ({ did: actor.did, name: actor.profile?.display_name || actor.profile?.handle || 'someone', avatar: actor.profile?.avatar_url })));
    load.catch(() => likers.delete(id));
    likers.set(id, load);
  }
  return load;
}

/** The likes column: hover for who liked it, click for everyone. */
export function LikesCell({ track, count, width, mine = false }: { track: Track; count: number; width: number; mine?: boolean }) {
  const theme = useAppearance();
  const [peek, setPeek] = useState<Liker[]>();
  const [open, setOpen] = useState<Anchor>();
  const cell = useRef<ViewInstance>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const style = { color: mine ? theme.accent : theme.muted, fontSize: 13.5 * theme.scale, fontVariant: ['tabular-nums' as const], textAlign: 'right' as const };
  if (count === 0) return <Text style={[style, { width, color: theme.faint }]}>–</Text>;
  const enter = () => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void firstLikers(track.id).then(setPeek, () => setPeek([])), 250);
  };
  const leave = () => { clearTimeout(timer.current); setPeek(undefined); };
  const label = `${count} ${count === 1 ? 'like' : 'likes'}${mine ? ', including you' : ''}`;
  const names = peek?.slice(0, 2).map(liker => liker.name) ?? [];
  const others = count - names.length;
  return <View ref={cell} style={{ width, alignItems: 'flex-end', zIndex: peek ? 10 : 0 }}>
    <Pressable accessibilityRole="button" accessibilityLabel={`See who liked ${track.metadata.title}, ${label}`} onHoverIn={enter} onHoverOut={leave} onFocus={enter} onBlur={leave}
      onPress={() => { leave(); cell.current?.measureInWindow((x, y, w, h) => setOpen({ x, y, width: w, height: h })); }} style={styles.count}>
      {({ hovered }: { pressed: boolean; hovered?: boolean }) => <Text style={[style, hovered ? { color: theme.text, textDecorationLine: 'underline' } : null]}>{compactCount(count)}</Text>}
    </Pressable>
    {peek && peek.length > 0 && <View pointerEvents="none" style={[styles.peek, { backgroundColor: theme.surface, borderColor: theme.line, boxShadow: theme.dark ? '0px 10px 30px #000000a6' : '0px 10px 30px #00000026' }]}>
      <View style={styles.stack}>{peek.slice(0, 5).map((liker, index) => <View key={liker.did} style={[styles.face, { marginLeft: index ? -8 : 0, borderColor: theme.surface }]}><Cover uri={liker.avatar} size={28} round instant /></View>)}</View>
      <View style={{ flexShrink: 1 }}>
        <Text numberOfLines={1} style={{ color: theme.text, fontSize: 13 * theme.scale }}>liked by {names.join(', ')}</Text>
        <Text numberOfLines={1} style={{ color: theme.faint, fontSize: 12.5 * theme.scale }}>{others > 0 ? `and ${others} ${others === 1 ? 'other' : 'others'} · ` : ''}click for all</Text>
      </View>
    </View>}
    {open && <Sheet title="liked by" anchor={open} close={() => setOpen(undefined)}><People id={track.id} close={() => setOpen(undefined)} /></Sheet>}
  </View>;
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  button: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  count: { minHeight: 36, minWidth: 36, justifyContent: 'center', alignItems: 'flex-end' },
  peek: { position: 'absolute', bottom: 40, right: -12, width: 320, flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderRadius: 14, borderWidth: 1 },
  stack: { flexDirection: 'row' },
  face: { borderWidth: 2, borderRadius: 16 },
});
