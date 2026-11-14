import { Link } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View, type ViewInstance } from 'react-native';
import { api, type Track } from './api';
import { useAppearance } from './appearance';
import { useAuth } from './auth';
import { Cover } from './CatalogPieces';
import { compactCount } from './home-state';
import { SignedOutHeart } from './RowActions';
import { Text } from './Text';
import { LikeButton, type Viewer } from './TrackLikes';

export type Liker = { did: string; name: string; handle?: string; avatar?: string | null };

const likers = new Map<string, Promise<Liker[]>>();
/** The first page of who liked a track, cached per track and like count so a new like is never hidden by an old answer. */
export function firstLikers(id: string, count?: number) {
  const key = `${id}:${count ?? ''}`;
  let load = likers.get(key);
  if (!load) {
    load = api.trackLikes(id).then(page => page.data.map(({ actor }) => ({ did: actor.did, name: actor.profile?.display_name || actor.profile?.handle || 'someone', handle: actor.profile?.handle, avatar: actor.profile?.avatar_url })));
    load.catch(() => likers.delete(key));
    likers.set(key, load);
  }
  return load;
}

const OPEN_AFTER = 200;
const CLOSE_AFTER = 150;
const FACE = 26;
const MOST = 8;
const skeleton: Liker[] = [0, 1, 2].map(index => ({ did: `loading-${index}`, name: '' }));

/** The likes column of a wide row: the heart, then the count. Pointing at or focusing the count opens who liked it,
 *  and the card stays open while the pointer or focus is on the count or the card, the way prod's likers tooltip does. */
export function LikesCell({ track, count, width, mine = false, onViewer, onOpen }: {
  track: Track; count: number; width: number; mine?: boolean; onViewer: (viewer: Viewer) => void; onOpen?: (open: boolean) => void;
}) {
  const theme = useAppearance();
  const auth = useAuth();
  const [open, setOpen] = useState(false);
  const [below, setBelow] = useState(false);
  const anchor = useRef<ViewInstance>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => { onOpen?.(open); }, [open, onOpen]);
  useEffect(() => { if (count === 0) setOpen(false); }, [count]);
  const reveal = () => {
    anchor.current?.measureInWindow((_x, y) => setBelow(y < 150));
    setOpen(true);
  };
  const show = (delay = OPEN_AFTER) => { clearTimeout(timer.current); if (!open) timer.current = setTimeout(reveal, delay); };
  const keep = () => clearTimeout(timer.current);
  const hide = () => { clearTimeout(timer.current); timer.current = setTimeout(() => setOpen(false), CLOSE_AFTER); };
  const toggle = () => { clearTimeout(timer.current); if (open) setOpen(false); else reveal(); };
  const label = `${count} ${count === 1 ? 'like' : 'likes'}${mine ? ', including yours' : ''}`;
  const heart = auth.did && auth.rpc ? <LikeButton key={`${auth.did}:${track.record.uri}`} small track={track} reportLiked={onViewer} /> : <SignedOutHeart track={track} />;
  return <View style={[styles.cell, { width, zIndex: open ? 10 : 0 }]}>
    {heart}
    {count > 0 && <View ref={anchor} style={styles.anchor}>
      <Pressable accessibilityRole="button" accessibilityLabel={`Who liked ${track.metadata.title}, ${label}`} aria-expanded={open}
        onHoverIn={() => show()} onHoverOut={hide} onFocus={() => show(0)} onBlur={hide} onPress={toggle} style={styles.count}>
        {({ hovered }: { pressed: boolean; hovered?: boolean }) => <Text style={{ color: mine ? theme.accent : hovered || open ? theme.text : theme.muted, fontSize: 13.5 * theme.scale, fontVariant: ['tabular-nums'] }}>
          {compactCount(count)}
        </Text>}
      </Pressable>
      {open && <LikersCard track={track} count={count} mine={mine} below={below} keep={keep} hide={hide} />}
    </View>}
  </View>;
}

function LikersCard({ track, count, mine, below, keep, hide }: { track: Track; count: number; mine: boolean; below: boolean; keep: () => void; hide: () => void }) {
  const theme = useAppearance();
  const auth = useAuth();
  const [people, setPeople] = useState<Liker[]>();
  const [failed, setFailed] = useState(false);
  const [pointed, setPointed] = useState<Liker>();
  const [cardWidth, setCardWidth] = useState(0);
  useEffect(() => {
    let live = true;
    firstLikers(track.id, count).then(list => { if (live) setPeople(list); }, () => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [track.id, count]);
  const shown = people && mine && auth.did && !people.some(person => person.did === auth.did)
    ? [{ did: auth.did, name: 'you', handle: auth.handle ?? undefined }, ...people] : people;
  const yours = (person: Liker) => person.did === auth.did;
  const first = shown?.[0];
  const others = count - 1;
  const summary = !first ? '' : `liked by ${yours(first) ? 'you' : first.name}${others > 0 ? ` and ${others} ${others === 1 ? 'other' : 'others'}` : ''}`;
  const faces = shown?.slice(0, Math.min(MOST, Math.max(count, 1)));
  const more = shown ? count - (faces?.length ?? 0) : 0;
  const caption = pointed ? (yours(pointed) ? 'you' : pointed.name) : summary;
  const detail = pointed?.handle && !yours(pointed) ? `@${pointed.handle}` : undefined;
  return <View onPointerEnter={keep} onPointerLeave={hide} onLayout={event => setCardWidth(event.nativeEvent.layout.width)}
    style={[styles.card, below ? styles.below : styles.above, { marginLeft: -cardWidth / 2, opacity: cardWidth ? 1 : 0,
      backgroundColor: theme.surface, borderColor: theme.dark ? theme.line : theme.border, boxShadow: theme.dark ? '0px 6px 20px #00000099' : '0px 4px 12px #00000014' }]}>
    {failed ? <Text style={{ color: theme.muted, fontSize: 13 * theme.scale }}>couldn’t load who liked this</Text> : <>
      <View style={styles.faces}>
        {(faces ?? skeleton).map((person, index) => {
          const overlap = { marginLeft: index ? -6 : 0 };
          const lifted = pointed?.did === person.did;
          const face = <View style={[styles.face, { borderColor: lifted ? theme.text : theme.surface, backgroundColor: theme.raised, transform: [{ translateY: lifted ? -2 : 0 }, { scale: lifted ? 1.08 : 1 }] }]}>
            {shown && <Cover uri={person.avatar} size={FACE} round instant />}
          </View>;
          return shown && person.handle ? <Link key={person.did} href={{ pathname: '/u/[handle]', params: { handle: person.handle } }} asChild>
            <Pressable accessibilityRole="link" accessibilityLabel={yours(person) ? 'You' : `${person.name}, @${person.handle}`}
              onHoverIn={() => setPointed(person)} onHoverOut={() => setPointed(undefined)} onFocus={() => { keep(); setPointed(person); }} onBlur={() => { setPointed(undefined); hide(); }}
              style={StyleSheet.flatten([styles.faceLink, overlap, { zIndex: lifted ? 2 : 0 }])}>{face}</Pressable>
          </Link> : <View key={person.did} style={overlap}>{face}</View>;
        })}
        {more > 0 && <View style={[styles.face, styles.more, { marginLeft: -6, borderColor: theme.surface, backgroundColor: theme.raised }]}>
          <Text style={{ color: theme.muted, fontSize: 11 * theme.scale, fontWeight: '700' }}>+{compactCount(more)}</Text>
        </View>}
      </View>
      <View style={styles.caption}>
        <Text numberOfLines={1} style={{ color: theme.text, fontSize: 13 * theme.scale, fontWeight: pointed ? '600' : '400', flexShrink: 1 }}>{shown ? caption : ' '}</Text>
        {detail && <Text numberOfLines={1} style={{ color: theme.muted, fontSize: 12.5 * theme.scale, flexShrink: 1 }}>{detail}</Text>}
      </View>
    </>}
  </View>;
}

const styles = StyleSheet.create({
  cell: { flexDirection: 'row', alignItems: 'center' },
  anchor: { position: 'relative' },
  count: { minHeight: 36, justifyContent: 'center', paddingHorizontal: 4, marginLeft: -4 },
  card: { position: 'absolute', left: '50%', minWidth: 140, maxWidth: 280, paddingHorizontal: 10, paddingVertical: 8, gap: 6, borderRadius: 12, borderWidth: 1, alignItems: 'center' },
  above: { bottom: '100%', marginBottom: -2 },
  below: { top: '100%', marginTop: -2 },
  faces: { flexDirection: 'row', paddingTop: 2 },
  more: { alignItems: 'center', justifyContent: 'center' },
  faceLink: { borderRadius: FACE / 2 + 2 },
  face: { width: FACE + 4, height: FACE + 4, borderRadius: FACE / 2 + 2, borderWidth: 2, overflow: 'hidden' },
  caption: { flexDirection: 'row', alignItems: 'baseline', gap: 6, maxWidth: 256, minHeight: 18 },
});
