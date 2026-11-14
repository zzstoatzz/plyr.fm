import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Platform, Pressable, StyleSheet, View } from 'react-native';
import type { TrackComment } from './api';
import { useAppearance } from './appearance';
import { Cover } from './CatalogPieces';
import { clock } from './chapters';
import { COUNT_WIDTH, FACE, SHOWN, STEP, clampLeft, passingComment, pileFaces, type Pile } from './comment-faces';
import { Text } from './Text';

/** Half the slider's thumb: where its track starts and ends, so a stem lands on the moment its comment names. */
export const SLIDER_INSET = Platform.OS === 'web' ? 10 : 15;
export const FACES_HEIGHT = 32;
const LIFTED = 24;
const CARD_WIDTH = 248;
const CARD_ROWS = 3;
const FAN_MOST = 8;
const OPEN_AFTER = 120;
const CLOSE_AFTER = 150;

export const commentAuthor = (comment: TrackComment) => comment.author.display_name || comment.author.handle || 'someone';
const at = (comment: TrackComment) => comment.timestamp_ms;

/** Commenter faces on short stems above a scrubber, as SoundCloud does. Nearby faces pile up; pointing at or focusing a pile fans it out
 *  with a card of what they said. Comments still ahead of the playhead are dimmed, and the one playback is passing lifts with its words. */
export function ScrubberFaces({ comments, durationMs, positionMs, playing, onSeek, seeAll }: {
  comments: TrackComment[]; durationMs: number; positionMs: number; playing: boolean;
  onSeek?: (ms: number) => void; seeAll?: { label: string; open: () => void };
}) {
  const theme = useAppearance();
  const [width, setWidth] = useState(0);
  const [open, setOpen] = useState<string>();
  const piles = useMemo(() => width ? pileFaces(comments, at, durationMs, width, SLIDER_INSET) : [], [comments, durationMs, width]);
  const passing = playing ? passingComment(comments, at, positionMs) : undefined;
  const openPile = piles.find(pile => pile.items[0].record.uri === open);
  useEffect(() => { if (open && !openPile) setOpen(undefined); }, [open, openPile]);
  return <View testID="scrubber-faces" onLayout={event => setWidth(event.nativeEvent.layout.width)} style={[styles.row, { zIndex: open || passing ? 20 : 1 }]}>
    {piles.map(pile => <FacePile key={pile.items[0].record.uri} pile={pile} positionMs={positionMs} passing={passing}
      open={open === pile.items[0].record.uri} setOpen={next => setOpen(next ? pile.items[0].record.uri : current => current === pile.items[0].record.uri ? undefined : current)}
      width={width} onSeek={onSeek} seeAll={seeAll} total={comments.length} />)}
    {passing && !openPile && width > 0 && <Bubble key={passing.record.uri} comment={passing} anchor={piles.find(pile => pile.items.includes(passing))?.anchor ?? 0} width={width} reduceMotion={theme.reduceMotion} />}
  </View>;
}

function FacePile({ pile, positionMs, passing, open, setOpen, width, onSeek, seeAll, total }: {
  pile: Pile<TrackComment>; positionMs: number; passing?: TrackComment; open: boolean; setOpen: (open: boolean) => void; width: number;
  onSeek?: (ms: number) => void; seeAll?: { label: string; open: () => void }; total: number;
}) {
  const theme = useAppearance();
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const inside = useRef({ pile: false, card: false });
  useEffect(() => () => clearTimeout(timer.current), []);
  const enter = (part: 'pile' | 'card', delay = OPEN_AFTER) => {
    inside.current[part] = true;
    clearTimeout(timer.current);
    if (!open) timer.current = setTimeout(() => setOpen(true), delay);
  };
  const leave = (part: 'pile' | 'card') => {
    inside.current[part] = false;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => { if (!inside.current.pile && !inside.current.card) setOpen(false); }, CLOSE_AFTER);
  };
  const lifted = passing && pile.items.includes(passing) ? passing : undefined;
  const shown = lifted ? [lifted, ...pile.items.filter(item => item !== lifted).slice(0, SHOWN - 1)] : pile.items.slice(0, SHOWN);
  const more = pile.items.length - SHOWN;
  const first = pile.items[0];
  const label = pile.items.length === 1 ? `Comment at ${clock(first.timestamp_ms / 1000)} from ${commentAuthor(first)}`
    : `${pile.items.length} comments from ${clock(first.timestamp_ms / 1000)} to ${clock(pile.items.at(-1)!.timestamp_ms / 1000)}`;
  return <>
    <View pointerEvents="none" style={[styles.stem, { left: pile.anchor - 0.5, backgroundColor: theme.dark ? theme.border : theme.line }]} />
    <Pressable accessibilityRole="button" accessibilityLabel={label} aria-expanded={open}
      onHoverIn={() => enter('pile')} onHoverOut={() => leave('pile')} onFocus={() => enter('pile', 0)} onBlur={() => leave('pile')}
      onPress={() => { clearTimeout(timer.current); setOpen(!open); }}
      onKeyDown={(event: { nativeEvent: { key?: string } }) => { if (event.nativeEvent.key === 'Escape') setOpen(false); }}
      style={[styles.pile, { left: pile.left, width: pile.width, opacity: open ? 0 : 1 }]}>
      {shown.map((comment, index) => {
        const big = comment === lifted;
        return <View key={comment.record.uri} style={[styles.face, {
          width: big ? LIFTED : FACE, height: big ? LIFTED : FACE, borderRadius: LIFTED, marginLeft: index ? STEP - FACE : 0,
          marginVertical: big ? -(LIFTED - FACE) / 2 : 0, zIndex: big ? SHOWN + 1 : SHOWN - index,
          borderColor: big ? theme.accent : theme.background, opacity: big || comment.timestamp_ms <= positionMs ? 1 : 0.5,
          transform: [{ translateY: big ? -3 : 0 }],
        }]}><Cover uri={comment.author.avatar_url} size={(big ? LIFTED : FACE) - 4} round instant /></View>;
      })}
      {more > 0 && <Text style={[styles.count, { width: COUNT_WIDTH, color: theme.muted, fontSize: 10.5 * theme.scale }]}>+{more}</Text>}
    </Pressable>
    {open && <Card pile={pile} width={width} enter={() => enter('card')} leave={() => leave('card')} onSeek={onSeek} seeAll={seeAll} total={total} />}
  </>;
}

function Card({ pile, width, enter, leave, onSeek, seeAll, total }: {
  pile: Pile<TrackComment>; width: number; enter: () => void; leave: () => void; onSeek?: (ms: number) => void; seeAll?: { label: string; open: () => void }; total: number;
}) {
  const theme = useAppearance();
  const fan = pile.items.slice(0, FAN_MOST);
  const fanWidth = fan.length * 26 + 6;
  const cardWidth = Math.min(CARD_WIDTH, width);
  const surface = { backgroundColor: theme.surface, borderColor: theme.dark ? theme.line : theme.border, boxShadow: theme.dark ? '0px 8px 24px #000000bb' : '0px 6px 16px #0000001f' };
  const rows = pile.items.slice(0, CARD_ROWS);
  const hidden = pile.items.length - rows.length;
  return <View onPointerEnter={enter} onPointerMove={enter} onPointerLeave={leave} style={StyleSheet.absoluteFill} pointerEvents="box-none">
    <View testID="scrubber-fan" style={[styles.fan, surface, { left: clampLeft(pile.anchor, fanWidth, width, 13), boxShadow: undefined }]}>
      {fan.map(comment => <Cover key={comment.record.uri} uri={comment.author.avatar_url} size={22} round instant />)}
    </View>
    <View testID="scrubber-card" style={[styles.card, surface, { left: clampLeft(pile.anchor, cardWidth, width), width: cardWidth }]}>
      {rows.map(comment => <View key={comment.record.uri} style={styles.cardRow}>
        <Cover uri={comment.author.avatar_url} size={22} round instant />
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={styles.cardHead}>
            <Text numberOfLines={1} style={{ flexShrink: 1, color: theme.text, fontSize: 12.5 * theme.scale, fontWeight: '600' }}>{commentAuthor(comment)}</Text>
            {onSeek ? <Pressable accessibilityRole="button" accessibilityLabel={`Play from ${clock(comment.timestamp_ms / 1000)}`} onPress={() => onSeek(comment.timestamp_ms)} hitSlop={8}>
              {({ hovered }: { pressed: boolean; hovered?: boolean }) => <Text style={[styles.stamp, { color: theme.accent, fontSize: 11 * theme.scale, textDecorationLine: hovered ? 'underline' : 'none' }]}>{clock(comment.timestamp_ms / 1000)}</Text>}
            </Pressable> : <Text style={[styles.stamp, { color: theme.accent, fontSize: 11 * theme.scale }]}>{clock(comment.timestamp_ms / 1000)}</Text>}
          </View>
          <Text numberOfLines={3} style={{ color: theme.text, fontSize: 12.5 * theme.scale, lineHeight: 17 * theme.scale }}>{comment.text}</Text>
        </View>
      </View>)}
      {hidden > 0 && (seeAll ? <Pressable accessibilityRole="link" accessibilityLabel={seeAll.label} onPress={seeAll.open} style={styles.more}>
        {({ hovered }: { pressed: boolean; hovered?: boolean }) => <Text style={{ color: hovered ? theme.text : theme.muted, fontSize: 12 * theme.scale, textDecorationLine: hovered ? 'underline' : 'none' }}>
          {hidden} more here · {seeAll.label.toLowerCase()}
        </Text>}
      </Pressable> : <Text style={[styles.more, { color: theme.muted, fontSize: 12 * theme.scale }]}>{hidden} more here, {total} in all</Text>)}
    </View>
  </View>;
}

function Bubble({ comment, anchor, width, reduceMotion }: { comment: TrackComment; anchor: number; width: number; reduceMotion: boolean }) {
  const theme = useAppearance();
  const [size, setSize] = useState(0);
  const rise = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;
  useEffect(() => {
    if (reduceMotion) { rise.setValue(1); return; }
    Animated.timing(rise, { toValue: 1, duration: 180, useNativeDriver: Platform.OS !== 'web' }).start();
  }, [rise, reduceMotion]);
  const left = clampLeft(anchor, size, width);
  const surface = { backgroundColor: theme.surface, borderColor: theme.dark ? theme.line : theme.border };
  return <Animated.View testID="scrubber-bubble" pointerEvents="none" onLayout={event => setSize(event.nativeEvent.layout.width)}
    style={[styles.bubble, surface, { left, maxWidth: Math.min(width, 320), opacity: size ? rise : 0, boxShadow: theme.dark ? '0px 6px 20px #000000aa' : '0px 4px 14px #00000024',
      transform: [{ translateY: rise.interpolate({ inputRange: [0, 1], outputRange: [6, 0] }) }] }]}>
    <Cover uri={comment.author.avatar_url} size={22} round instant />
    <Text numberOfLines={1} style={{ flexShrink: 1, color: theme.text, fontSize: 12.5 * theme.scale }}>
      <Text style={{ fontWeight: '600' }}>{commentAuthor(comment)}</Text>{'  '}{comment.text}
    </Text>
    <View style={[styles.tail, surface, { left: Math.max(10, Math.min(size - 20, anchor - left - 5)) }]} />
  </Animated.View>;
}

const styles = StyleSheet.create({
  row: { height: FACES_HEIGHT, marginBottom: -6, position: 'relative' },
  stem: { position: 'absolute', top: FACE - 2, bottom: 0, width: 1 },
  pile: { position: 'absolute', top: 0, height: FACE, flexDirection: 'row', alignItems: 'center' },
  face: { borderWidth: 2, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  count: { fontWeight: '700', fontVariant: ['tabular-nums'], paddingLeft: 4 },
  fan: { position: 'absolute', top: -5, height: 30, flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 3, borderRadius: 15, borderWidth: 1 },
  card: { position: 'absolute', bottom: FACES_HEIGHT + 2, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12, borderWidth: 1 },
  cardRow: { flexDirection: 'row', gap: 9, alignItems: 'flex-start', paddingVertical: 5 },
  cardHead: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  stamp: { fontWeight: '700', fontVariant: ['tabular-nums'] },
  more: { paddingLeft: 31, paddingTop: 4, paddingBottom: 2 },
  bubble: { position: 'absolute', bottom: FACES_HEIGHT + 14, flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 5, paddingLeft: 5, paddingRight: 12, borderRadius: 16, borderWidth: 1 },
  tail: { position: 'absolute', bottom: -6, width: 10, height: 10, borderRightWidth: 1, borderBottomWidth: 1, transform: [{ rotate: '45deg' }] },
});
