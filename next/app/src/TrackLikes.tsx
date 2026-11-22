import { Heart, ArrowsClockwise as RefreshCw } from './icons';
import { Text } from './Text';
import { Link } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { type Track } from '@plyr/next-core/api';
import { Row } from './CatalogPieces';
import { useAuth } from './auth';
import { ActionRow } from './ActionRow';
import { Sheet } from './Sheet';
import { WaveLoading } from './WaveLoading';
import { useAppearance } from './appearance';
import { toast } from './toast';
import { LikeHeart } from './LikeHeart';
import { likes, useLikers, useTrackLike } from './likes';

export function TrackLikes({ track, compact = false, returnTo, menu = false, iconOnly = false, onNavigate }: { track: Track; compact?: boolean; returnTo?: string; menu?: boolean; iconOnly?: boolean; onNavigate?: () => void }) {
  const [open, setOpen] = useState(false);
  const auth = useAuth();
  const theme = useAppearance();
  const { count } = useTrackLike(track);
  const label = `${count} ${count === 1 ? 'like' : 'likes'}`;
  return <>
    <View testID="track-like-controls" style={menu ? undefined : { flexDirection: 'row', alignItems: 'center' }}>
      {auth.did && auth.rpc ? <LikeButton key={`${auth.did}:${track.record.uri}`} track={track} menu={menu} /> : menu ? <ActionRow icon={Heart} label="sign in to like" href={{ pathname: '/login', params: { return_to: returnTo ?? `/track/${track.id}` } }} onPress={onNavigate} /> :
        <Link href={{ pathname: '/login', params: { return_to: returnTo ?? `/track/${track.id}` } }} asChild>
          <Pressable accessibilityRole="link" accessibilityLabel="sign in to like" style={target}>
            <Heart size={21} color={theme.muted} />
          </Pressable>
        </Link>}
      {!menu && !iconOnly && <Pressable accessibilityRole="button" accessibilityLabel={`See ${label}`} onPress={() => setOpen(true)} style={[target, { paddingHorizontal: 4 }]}>
        <Text numberOfLines={1} style={{ color: theme.muted, fontSize: 14 * theme.scale }}>{compact ? count : label}</Text>
      </Pressable>}
    </View>
    {open && <Sheet title="liked by" close={() => setOpen(false)}><People track={track} close={() => setOpen(false)} /></Sheet>}
  </>;
}

/** Likes or unlikes at once and toasts where the write settled; a tap before your like has loaded loads it and retries. */
export async function toggleLike(track: Track) {
  const before = likes.snapshot(track);
  if (!before.known && before.error) toast.error('failed to load like — retrying');
  const outcome = await likes.toggle(track);
  if (!outcome) return;
  const key = `like:${track.record.uri}`;
  if (outcome.failed) toast.add('failed to update like', 'error', 5000, undefined, key);
  else if (outcome.changed) toast.add(`${outcome.value ? 'liked' : 'unliked'} ${track.metadata.title}`, outcome.value ? 'success' : 'info', 3000, undefined, key);
}

export function LikeButton({ track, menu, small = false }: { track: Track; menu?: boolean; small?: boolean }) {
  const state = useTrackLike(track);
  useEffect(() => { void likes.load(track); }, [track]);
  const liked = state.known ? state.liked : undefined;
  const retry = !state.known && !!state.error;
  const loading = !state.known && !state.error;
  return menu ? <ActionRow icon={Heart} label={retry ? 'retry like status' : liked ? 'unlike' : 'like'} disabled={loading} onPress={() => void toggleLike(track)} />
    : <Pressable accessibilityRole="button" accessibilityLabel={retry ? 'retry like status' : liked ? 'Unlike' : 'Like'}
      accessibilityState={{ selected: liked ?? false, busy: loading, disabled: loading }}
      disabled={loading} onPress={() => void toggleLike(track)} style={[small ? smallTarget : target, { opacity: liked === undefined ? 0.5 : 1 }]}>
      <LikeHeart liked={liked} size={small ? 18 : 21} />
    </Pressable>;
}

/** Who liked the track, from the shared like state, so a like you just made is already listed. */
export function People({ track, close }: { track: Track; close: () => void }) {
  const list = useLikers(track);
  const theme = useAppearance();
  useEffect(() => { void likes.loadLikers(track); }, [track]);
  return <>
    {list.people.map(actor => <Row key={actor.did} round
      image={actor.profile?.avatar_url} title={actor.profile?.display_name || actor.profile?.handle || actor.did}
      subtitle={actor.profile?.handle ? `@${actor.profile.handle}` : undefined}
      href={{ pathname: '/u/[handle]', params: { handle: actor.profile?.handle || actor.did } }} onNavigate={close} />)}
    {list.loading && <WaveLoading label="Loading likes" />}
    {list.error && !list.loading && <><Text style={{ color: theme.muted }}>couldn’t load who liked this</Text><ActionRow label="retry" icon={RefreshCw} onPress={() => void likes.loadLikers(track)} /></>}
    {list.loaded && !list.loading && !list.error && !list.people.length && <Text style={{ color: theme.muted }}>no likes yet.</Text>}
    {list.more && !list.loading && !list.error && <ActionRow label="more people" icon={RefreshCw} onPress={() => void likes.loadLikers(track, { more: true })} />}
  </>;
}

const target = { minWidth: 44, height: 44, alignItems: 'center', justifyContent: 'center' } as const;
const smallTarget = { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' } as const;
