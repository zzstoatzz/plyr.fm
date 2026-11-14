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

/** Add-to-queue for a wide row, shown while the row is hovered or focused. */
export function QueueButton({ track, shown }: { track: Track; shown: boolean }) {
  const player = usePlayback();
  const theme = useAppearance();
  const [focused, setFocused] = useState(false);
  const visible = shown || focused;
  return <Pressable onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} accessibilityRole="button" accessibilityLabel={`Add ${track.metadata.title} to queue`} onPress={() => { player.enqueue(track); toast.success(`queued ${track.metadata.title}`); }}
      style={({ hovered }: { pressed: boolean; hovered?: boolean }) => [styles.button, { opacity: visible ? 1 : 0, backgroundColor: hovered ? theme.raised : 'transparent' }]}>
      <ListPlus size={18} color={theme.muted} />
    </Pressable>;
}

/** Signed out, the heart shakes its head and offers sign-in, which comes back here and finishes the like. */
export function SignedOutHeart({ track }: { track: Track }) {
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

const styles = StyleSheet.create({
  button: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
});
