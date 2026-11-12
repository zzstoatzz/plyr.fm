import { beginLikeInteraction, setLikeInteraction, useLikeInteraction } from './like-interactions';
import { Text } from './Text';
import { Link } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import Heart from 'lucide-react-native/icons/heart';
import RefreshCw from 'lucide-react-native/icons/refresh-cw';
import { api, type Track } from './api';
import { Row, usePages, useResource } from './CatalogPieces';
import { useAuth } from './auth';
import { createPds } from './pds';
import { ActionRow } from './ActionRow';
import { Sheet } from './Sheet';
import { WaveLoading } from './WaveLoading';
import { useAppearance } from './appearance';
import { toast } from './toast';

export function TrackLikes({ track, compact = false, returnTo, menu = false, iconOnly = false, onNavigate }: { track: Track; compact?: boolean; returnTo?: string; menu?: boolean; iconOnly?: boolean; onNavigate?: () => void }) {
  const [open, setOpen] = useState(false);
  const [viewer, setViewer] = useState<{ did: string; uri: string; liked: boolean }>();
  const [count, setCount] = useState(track.metrics.like_count);
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
    <View testID="track-like-controls" style={menu ? undefined : { flexDirection: 'row', alignItems: 'center' }}>
      {auth.did && auth.rpc ? <LikeButton key={`${auth.did}:${track.record.uri}`} track={track} change={change} reportLiked={setViewer} menu={menu} /> : menu ? <ActionRow icon={Heart} label="sign in to like" href={{ pathname: '/login', params: { return_to: returnTo ?? `/track/${track.id}` } }} onPress={onNavigate} /> :
        <Link href={{ pathname: '/login', params: { return_to: returnTo ?? `/track/${track.id}` } }} asChild>
          <Pressable accessibilityRole="link" accessibilityLabel="sign in to like" style={target}>
            <Heart size={21} color={theme.muted} />
          </Pressable>
        </Link>}
      {!menu && !iconOnly && <Pressable accessibilityRole="button" accessibilityLabel={`See ${label}`} onPress={() => setOpen(true)} style={[target, { paddingHorizontal: 4 }]}>
        <Text numberOfLines={1} style={{ color: theme.muted, fontSize: 14 * theme.scale }}>{compact ? count : label}</Text>
      </Pressable>}
    </View>
    {open && <Sheet title="liked by" close={() => setOpen(false)}><People id={track.id} viewer={viewer?.did === auth.did && viewer.uri === track.record.uri ? viewer : undefined} close={() => setOpen(false)} /></Sheet>}
  </>;
}

function LikeButton({ track, change, reportLiked, menu }: {
  track: Track; change: (delta: number) => () => void;
  menu?: boolean;
  reportLiked: (state: { did: string; uri: string; liked: boolean }) => void;
}) {
  const { did, rpc } = useAuth();
  const theme = useAppearance();
  const pds = useMemo(() => createPds({ did, rpc }), [did, rpc]);
  const load = useCallback(() => pds.myLikes().then(likes => likes.has(track.record.uri)), [pds, track.record.uri]);
  const result = useResource(load);
  const shared = useLikeInteraction(rpc, track.record.uri);
  const busy = shared?.busy ?? false;
  const lock = useRef(false);
  const liked = shared?.liked ?? result.data;
  useEffect(() => { if (did && liked !== undefined) reportLiked({ did, uri: track.record.uri, liked }); }, [did, liked, track.record.uri, reportLiked]);
  async function toggle() {
    if (lock.current || busy || !rpc) return;
    if (liked === undefined) { if (result.error) { toast.error('failed to load like — retrying'); result.retry(); } return; }
    if (!beginLikeInteraction(rpc, track.record.uri, !liked)) return;
    lock.current = true;
    let confirmed = !liked;
    const rollback = change(liked ? -1 : 1);
    try {
      await (liked ? pds.unlike(track, { waitForIndex: false }) : pds.like(track, { waitForIndex: false }));
      if (liked) toast.info(`unliked ${track.metadata.title}`); else toast.success(`liked ${track.metadata.title}`);
    } catch {
      confirmed = liked;
      rollback();
      setLikeInteraction(rpc, track.record.uri, { liked, busy: true });
      toast.error('failed to update like');
    } finally {
      lock.current = false;
      setLikeInteraction(rpc, track.record.uri, { liked: confirmed, busy: false });
    }
  }
  return <>
    {menu ? <ActionRow icon={Heart} label={result.error && liked === undefined ? 'retry like status' : liked ? 'unlike' : 'like'} disabled={busy || liked === undefined && !result.error} onPress={() => void toggle()} /> : <Pressable accessibilityRole="button" accessibilityLabel={result.error && liked === undefined ? 'retry like status' : liked ? 'Unlike' : 'Like'}
      accessibilityState={{ selected: liked ?? false, busy: busy || liked === undefined && !result.error, disabled: busy || liked === undefined && !result.error }}
      disabled={busy || liked === undefined && !result.error} onPress={() => void toggle()}
      style={[target, { opacity: busy || liked === undefined ? 0.5 : 1 }]}>
      <Heart size={21} color={liked ? theme.accent : theme.muted} fill={liked ? theme.accent : 'none'} />
    </Pressable>}
  </>;
}

function People({ id, viewer, close }: { id: string; viewer?: { did: string; uri: string; liked: boolean }; close: () => void }) {
  const load = useCallback((cursor?: string) => api.trackLikes(id, cursor), [id]);
  const likes = usePages(load);
  const auth = useAuth();
  const ownProfile = useCallback(() => viewer?.liked ? api.artist(viewer.did) : Promise.resolve(undefined), [viewer?.did, viewer?.liked]);
  const profile = useResource(ownProfile);
  const actors = [...new Map(likes.data.filter(({ actor }) => actor.did !== viewer?.did)
    .map(({ actor }) => [actor.did, actor] as const)).values()];
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
    {!likes.loading && !likes.error && !actors.length && <Text style={{ color: theme.muted }}>no likes yet.</Text>}
    {likes.cursor && !likes.loading && !likes.error && <ActionRow label="more people" icon={RefreshCw} onPress={likes.more} />}
  </>;
}

const target = { minWidth: 44, height: 44, alignItems: 'center', justifyContent: 'center' } as const;
