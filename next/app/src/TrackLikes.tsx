import { Text } from './Text';
import { useCallback, useState } from 'react';
import { Pressable } from 'react-native';
import Heart from 'lucide-react-native/icons/heart';
import { api, type Track } from './api';
import { Button, Row, Status, usePages } from './CatalogPieces';
import { Sheet } from './Sheet';
import { useAppearance } from './appearance';

export function TrackLikes({ track, compact = false }: { track: Track; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const theme = useAppearance();
  const count = track.metrics.like_count;
  const label = `${count} ${count === 1 ? 'like' : 'likes'}`;
  return <>
    <Pressable accessibilityRole="button" accessibilityLabel={`See ${label}`} onPress={() => setOpen(true)}
      style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 6 }}>
      <Heart size={17} color={theme.muted} />
      <Text numberOfLines={1} style={{ color: theme.text, fontWeight: '600', fontSize: 14 * theme.scale }}>{compact ? count : label}</Text>
    </Pressable>
    {open && <Sheet title="Liked by" close={() => setOpen(false)}><People id={track.id} close={() => setOpen(false)} /></Sheet>}
  </>;
}

function People({ id, close }: { id: string; close: () => void }) {
  const load = useCallback((cursor?: string) => api.trackLikes(id, cursor), [id]);
  const likes = usePages(load);
  return <>
    {likes.data.map(({ record, actor }) => <Row key={record.uri} round
      image={actor.profile?.avatar_url}
      title={actor.profile?.display_name || actor.profile?.handle || actor.did}
      subtitle={actor.profile?.handle ? `@${actor.profile.handle}` : undefined}
      href={{ pathname: '/u/[handle]', params: { handle: actor.profile?.handle || actor.did } }}
      onNavigate={close} />)}
    <Status loading={likes.loading} error={likes.error} retry={likes.more} empty={!likes.data.length ? 'No likes yet.' : undefined} />
    {likes.cursor && !likes.loading && !likes.error && <Button label="More people" onPress={likes.more} />}
  </>;
}
