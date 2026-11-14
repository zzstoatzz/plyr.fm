import { useLikeInteraction, wantLike } from './like-interactions';
import { Heart, ArrowsClockwise as RefreshCw } from './icons';
import { Text } from './Text';
import { Link } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { api, type Track } from './api';
import { Row, usePages, useResource } from './CatalogPieces';
import { useAuth } from './auth';
import { createPds } from './pds';
import { ActionRow } from './ActionRow';
import { Sheet } from './Sheet';
import { WaveLoading } from './WaveLoading';
import { useAppearance } from './appearance';
import { toast } from './toast';
import { LikeHeart } from './LikeHeart';

export function TrackLikes({ track, compact = false, returnTo, menu = false, iconOnly = false, onNavigate }: { track: Track; compact?: boolean; returnTo?: string; menu?: boolean; iconOnly?: boolean; onNavigate?: () => void }) {
  const [open, setOpen] = useState(false);
  const [viewer, setViewer] = useState<Viewer>();
  const auth = useAuth();
  const theme = useAppearance();
  const own = viewer?.did === auth.did && viewer.uri === track.record.uri ? viewer : undefined;
  const count = Math.max(0, track.metrics.like_count + (own ? Number(own.liked) - Number(own.loaded) : 0));
  const label = `${count} ${count === 1 ? 'like' : 'likes'}`;
  return <>
    <View testID="track-like-controls" style={menu ? undefined : { flexDirection: 'row', alignItems: 'center' }}>
      {auth.did && auth.rpc ? <LikeButton key={`${auth.did}:${track.record.uri}`} track={track} reportLiked={setViewer} menu={menu} /> : menu ? <ActionRow icon={Heart} label="sign in to like" href={{ pathname: '/login', params: { return_to: returnTo ?? `/track/${track.id}` } }} onPress={onNavigate} /> :
        <Link href={{ pathname: '/login', params: { return_to: returnTo ?? `/track/${track.id}` } }} asChild>
          <Pressable accessibilityRole="link" accessibilityLabel="sign in to like" style={target}>
            <Heart size={21} color={theme.muted} />
          </Pressable>
        </Link>}
      {!menu && !iconOnly && <Pressable accessibilityRole="button" accessibilityLabel={`See ${label}`} onPress={() => setOpen(true)} style={[target, { paddingHorizontal: 4 }]}>
        <Text numberOfLines={1} style={{ color: theme.muted, fontSize: 14 * theme.scale }}>{compact ? count : label}</Text>
      </Pressable>}
    </View>
    {open && <Sheet title="liked by" close={() => setOpen(false)}><People id={track.id} viewer={own} close={() => setOpen(false)} /></Sheet>}
  </>;
}

/** The viewer's like as loaded from their PDS and as it stands now; the count moves by the difference. */
type Viewer = { did: string; uri: string; loaded: boolean; liked: boolean };

function LikeButton({ track, reportLiked, menu }: { track: Track; reportLiked: (state: Viewer) => void; menu?: boolean }) {
  const { did, rpc } = useAuth();
  const pds = useMemo(() => createPds({ did, rpc }), [did, rpc]);
  const load = useCallback(() => pds.myLikes().then(likes => likes.has(track.record.uri)), [pds, track.record.uri]);
  const result = useResource(load);
  const shared = useLikeInteraction(rpc, track.record.uri);
  const liked = shared?.liked ?? result.data;
  useEffect(() => {
    if (did && liked !== undefined && result.data !== undefined) reportLiked({ did, uri: track.record.uri, loaded: result.data, liked });
  }, [did, liked, result.data, track.record.uri, reportLiked]);
  const loading = liked === undefined && !result.error;
  async function toggle() {
    if (!rpc) return;
    if (liked === undefined) { if (result.error) { toast.error('failed to load like — retrying'); result.retry(); } return; }
    const outcome = await wantLike(rpc, track.record.uri, liked, !liked,
      next => next ? pds.like(track, { waitForIndex: false }) : pds.unlike(track, { waitForIndex: false }));
    if (!outcome) return;
    const key = `like:${track.record.uri}`;
    if (outcome.failed) toast.add('failed to update like', 'error', 5000, undefined, key);
    else if (outcome.changed) toast.add(`${outcome.liked ? 'liked' : 'unliked'} ${track.metadata.title}`, outcome.liked ? 'success' : 'info', 3000, undefined, key);
  }
  const retry = result.error && liked === undefined;
  return menu ? <ActionRow icon={Heart} label={retry ? 'retry like status' : liked ? 'unlike' : 'like'} disabled={loading} onPress={() => void toggle()} />
    : <Pressable accessibilityRole="button" accessibilityLabel={retry ? 'retry like status' : liked ? 'Unlike' : 'Like'}
      accessibilityState={{ selected: liked ?? false, busy: loading, disabled: loading }}
      disabled={loading} onPress={() => void toggle()} style={[target, { opacity: liked === undefined ? 0.5 : 1 }]}>
      <LikeHeart liked={liked} />
    </Pressable>;
}

function People({ id, viewer, close }: { id: string; viewer?: Viewer; close: () => void }) {
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
