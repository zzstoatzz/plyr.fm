import { Text } from './Text';
import { Link } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import Heart from 'lucide-react-native/icons/heart';
import X from 'lucide-react-native/icons/x';
import RefreshCw from 'lucide-react-native/icons/refresh-cw';
import { api, type Track } from './api';
import { Row, errorMessage, usePages, useResource } from './CatalogPieces';
import { useAuth } from './auth';
import { createPds } from './pds';
import { ActionRow } from './ActionRow';
import { Sheet } from './Sheet';
import { WaveLoading } from './WaveLoading';
import { useAppearance } from './appearance';

export function TrackLikes({ track, compact = false }: { track: Track; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const [viewer, setViewer] = useState<{ did: string; uri: string; liked: boolean }>();
  const [count, setCount] = useState(track.metrics.like_count);
  const [error, setError] = useState<string>();
  const version = useRef(0);
  const auth = useAuth();
  const theme = useAppearance();
  useEffect(() => { version.current++; setCount(track.metrics.like_count); }, [track.id, track.metrics.like_count]);
  function change(delta: number) {
    const current = version.current;
    const previous = count;
    setCount(Math.max(0, previous + delta));
    return () => { if (version.current === current) setCount(previous); };
  }
  const label = `${count} ${count === 1 ? 'like' : 'likes'}`;
  return <>
    <View testID="track-like-controls" style={{ flexDirection: 'row', alignItems: 'center' }}>
      {auth.did && auth.rpc ? <LikeButton key={`${auth.did}:${track.record.uri}`} track={track} change={change} reportError={setError} reportLiked={setViewer} /> :
        <Link href={{ pathname: '/login', params: { return_to: `/track/${track.id}` } }} asChild>
          <Pressable accessibilityRole="link" accessibilityLabel="sign in to like" style={target}>
            <Heart size={21} color={theme.muted} />
          </Pressable>
        </Link>}
      <Pressable accessibilityRole="button" accessibilityLabel={`See ${label}`} onPress={() => setOpen(true)} style={[target, { paddingHorizontal: 4 }]}>
        <Text numberOfLines={1} style={{ color: theme.muted, fontSize: 14 * theme.scale }}>{compact ? count : label}</Text>
      </Pressable>
    </View>
    {open && <Sheet title="Liked by" close={() => setOpen(false)}><People id={track.id} viewer={viewer?.did === auth.did && viewer.uri === track.record.uri ? viewer : undefined} close={() => setOpen(false)} /></Sheet>}
    {error && <Sheet title="Couldn’t update like" close={() => setError(undefined)}>
      <Text style={{ color: theme.muted, fontSize: 15 * theme.scale }}>{error}</Text>
      <ActionRow label="close" icon={X} onPress={() => setError(undefined)} />
    </Sheet>}
  </>;
}

function LikeButton({ track, change, reportError, reportLiked }: {
  track: Track; change: (delta: number) => () => void; reportError: (error: string) => void;
  reportLiked: (state: { did: string; uri: string; liked: boolean }) => void;
}) {
  const { did, rpc } = useAuth();
  const theme = useAppearance();
  const pds = useMemo(() => createPds({ did, rpc }), [did, rpc]);
  const load = useCallback(() => pds.myLikes().then(likes => likes.has(track.record.uri)), [pds, track.record.uri]);
  const result = useResource(load);
  const [override, setOverride] = useState<boolean>();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const lock = useRef(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const liked = override ?? result.data;
  useEffect(() => { if (did && liked !== undefined) reportLiked({ did, uri: track.record.uri, liked }); }, [did, liked, track.record.uri, reportLiked]);
  async function toggle() {
    if (lock.current) return;
    if (liked === undefined) { if (result.error) { reportError(result.error); result.retry(); } return; }
    lock.current = true;
    setBusy(true);
    setOverride(!liked);
    const rollback = change(liked ? -1 : 1);
    try {
      const saved = await (liked ? pds.unlike(track, { waitForIndex: false }) : pds.like(track, { waitForIndex: false }));
      if (alive.current) setStatus(saved === 'pending' ? 'Like saved. Updating catalog.' : liked ? 'Like removed.' : 'Track liked.');
    } catch (error) {
      rollback();
      if (alive.current) { setOverride(liked); reportError(errorMessage(error)); }
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  }
  return <>
    <Pressable accessibilityRole="button" accessibilityLabel={result.error && liked === undefined ? 'retry like status' : liked ? 'Unlike' : 'Like'}
      accessibilityState={{ selected: liked ?? false, busy: busy || liked === undefined && !result.error, disabled: busy || liked === undefined && !result.error }}
      disabled={busy || liked === undefined && !result.error} onPress={() => void toggle()}
      style={[target, { opacity: busy || liked === undefined ? 0.5 : 1 }]}>
      <Heart size={21} color={liked ? theme.accent : theme.muted} fill={liked ? theme.accent : 'none'} />
    </Pressable>
    <Text accessibilityLiveRegion="polite" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', color: 'transparent' }}>{status}</Text>
  </>;
}

function People({ id, viewer, close }: { id: string; viewer?: { did: string; uri: string; liked: boolean }; close: () => void }) {
  const load = useCallback((cursor?: string) => api.trackLikes(id, cursor), [id]);
  const likes = usePages(load);
  const auth = useAuth();
  const ownProfile = useCallback(() => viewer?.liked ? api.artist(viewer.did) : Promise.resolve(undefined), [viewer?.did, viewer?.liked]);
  const profile = useResource(ownProfile);
  const actors = likes.data.filter(({ actor }) => actor.did !== viewer?.did).map(({ actor }) => actor);
  if (viewer?.liked) actors.unshift({ did: viewer.did, profile: {
    handle: profile.data?.handle || auth.handle || undefined,
    display_name: profile.data?.display_name, avatar_url: profile.data?.avatar_url
  } });
  const theme = useAppearance();
  return <>
    {actors.map(actor => <Row key={actor.did} round
      image={actor.profile?.avatar_url} title={actor.profile?.display_name || actor.profile?.handle || actor.did}
      subtitle={actor.profile?.handle ? `@${actor.profile.handle}` : undefined}
      href={{ pathname: '/u/[handle]', params: { handle: actor.profile?.handle || actor.did } }} onNavigate={close} />)}
    {likes.loading && <WaveLoading label="Loading likes" />}
    {likes.error && <><Text style={{ color: theme.muted }}>{likes.error}</Text><ActionRow label="retry" icon={RefreshCw} onPress={likes.more} /></>}
    {!likes.loading && !likes.error && !actors.length && <Text style={{ color: theme.muted }}>No likes yet.</Text>}
    {likes.cursor && !likes.loading && !likes.error && <ActionRow label="more people" icon={RefreshCw} onPress={likes.more} />}
  </>;
}

const target = { minWidth: 44, height: 44, alignItems: 'center', justifyContent: 'center' } as const;
