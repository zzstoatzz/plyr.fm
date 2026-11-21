import { useEffect, useRef, useState } from 'react';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { Animated, Image, PixelRatio, Pressable, ScrollView, StyleSheet, View, type ScrollViewInstance } from 'react-native';
import type { Track, TrackComment } from '@plyr/next-core/api';
import { displayUrl } from '@plyr/next-core/artwork';
import { clock } from '@plyr/next-core/chapters';
import { SHOW_MS, commentAuthor, commentTimeline, emojiOnly, reachedComments, type Moment } from '@plyr/next-core/timed-comments';
import { useAppearance } from './appearance';
import { Cover } from './CatalogPieces';
import { CommentComposer } from './CommentComposer';
import { X } from './icons';
import { Text } from './Text';

const at = (comment: TrackComment) => comment.timestamp_ms;
const FADE_MS = 400;

/** Comments rise over the cover as playback reaches them, then fade. Any one of them opens the comments view. */
export function CoverComments({ comments, positionMs, size, open }: { comments: TrackComment[]; positionMs: number; size: number; open: () => void }) {
  const reached = reachedComments(comments, at, positionMs);
  const inset = size >= 500 ? 18 : 12;
  return <View testID="cover-comments" pointerEvents="box-none" accessibilityLiveRegion="polite" style={[styles.chips, { left: inset, right: inset, bottom: inset }]}>
    {reached.map((comment, index) => <Chip key={comment.record.uri} comment={comment} earlier={index < reached.length - 1}
      leaving={positionMs - comment.timestamp_ms > SHOW_MS - FADE_MS} large={size >= 500} open={open} />)}
  </View>;
}

function Chip({ comment, earlier, leaving, large, open }: { comment: TrackComment; earlier: boolean; leaving: boolean; large: boolean; open: () => void }) {
  const theme = useAppearance();
  const rise = useRef(new Animated.Value(theme.reduceMotion ? 1 : 0)).current;
  const shown = leaving ? 0 : earlier ? 0.55 : 1;
  useEffect(() => {
    Animated.timing(rise, { toValue: 1, duration: theme.reduceMotion ? 0 : 240, useNativeDriver: true }).start();
  }, [rise, theme.reduceMotion]);
  const opacity = useRef(new Animated.Value(shown)).current;
  useEffect(() => {
    Animated.timing(opacity, { toValue: shown, duration: theme.reduceMotion ? 0 : leaving ? FADE_MS : 200, useNativeDriver: true }).start();
  }, [opacity, shown, leaving, theme.reduceMotion]);
  const emoji = emojiOnly(comment.text);
  const name = commentAuthor(comment);
  return <Animated.View style={{ maxWidth: '100%', opacity: Animated.multiply(rise, opacity),
    transform: [{ translateY: rise.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }, { scale: earlier ? 0.94 : 1 }], transformOrigin: 'left bottom' }}>
    <Pressable testID="cover-comment" accessibilityRole="button" accessibilityLabel={`${name} at ${clock(comment.timestamp_ms / 1000)}: ${comment.text}. Show all comments`}
      onPress={open} style={[styles.chip, large && styles.chipLarge]}>
      <Cover uri={comment.author.avatar_url} size={large ? 40 : 32} round instant />
      <View style={{ flexShrink: 1, minWidth: 0 }}>
        <View style={styles.who}>
          <Text numberOfLines={1} style={{ flexShrink: 1, color: '#ffffff', fontSize: (large ? 13.5 : 12.5) * theme.scale, fontWeight: '700' }}>{name}</Text>
          <Text style={{ color: '#ffffffb8', fontSize: (large ? 13.5 : 12.5) * theme.scale, fontVariant: ['tabular-nums'] }}>{clock(comment.timestamp_ms / 1000)}</Text>
        </View>
        <Text numberOfLines={2} style={{ color: '#ffffff', fontSize: (emoji ? 26 : large ? 18 : 15.5) * theme.scale, lineHeight: (emoji ? 30 : large ? 23 : 20) * theme.scale }}>{comment.text}</Text>
      </View>
    </Pressable>
  </Animated.View>;
}

/** The cover turned into the track's comments, kept in step with playback the way synced lyrics are. */
export function CommentsView({ track, comments, art, positionMs, size, seek, close, returnTo }: {
  track: Track; comments: TrackComment[]; art?: string; positionMs: number; size: number; returnTo: string;
  seek?: (seconds: number) => void; close: () => void;
}) {
  const theme = useAppearance();
  const timeline = commentTimeline(comments, at, positionMs);
  const scroll = useRef<ScrollViewInstance>(null);
  const rows = useRef<{ y: number; height: number }[]>([]);
  const [viewport, setViewport] = useState(0);
  const touchedAt = useRef(0);
  // Follow playback unless the listener scrolled the list themselves in the last few seconds.
  useEffect(() => {
    const row = rows.current[timeline.focus];
    if (!row || !viewport || Date.now() - touchedAt.current < 4000) return;
    scroll.current?.scrollTo({ y: Math.max(0, row.y - viewport / 2 + row.height / 2), animated: !theme.reduceMotion });
  }, [timeline.focus, viewport, theme.reduceMotion, comments.length]);
  const wash = art ? [...new Set([displayUrl(art, 160, PixelRatio.get()), art])][0] : undefined;
  return <View testID="comments-view" accessibilityLabel="Comments" style={[styles.view, { width: size, height: size, backgroundColor: theme.surface }]}>
    {wash && <Image aria-hidden source={{ uri: wash }} blurRadius={40} resizeMode="cover" style={[StyleSheet.absoluteFill, { transform: [{ scale: 1.4 }] }]} />}
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: theme.background, opacity: 0.62 }]} />
    <View style={styles.header}>
      <Text style={{ color: theme.text, fontSize: 15 * theme.scale, fontWeight: '700' }}>comments{comments.length ? <Text style={{ color: theme.muted, fontWeight: '400' }}> {comments.length}</Text> : null}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Show the cover" onPress={close} hitSlop={8} style={styles.close}><X size={18} color={theme.muted} /></Pressable>
    </View>
    <ScrollView ref={scroll} style={{ flex: 1 }} onLayout={event => setViewport(event.nativeEvent.layout.height)}
      onScrollBeginDrag={() => { touchedAt.current = Date.now(); }} showsVerticalScrollIndicator={false}
      contentContainerStyle={{ paddingHorizontal: 18, paddingVertical: viewport * 0.35 }}>
      {timeline.rows.length ? timeline.rows.map(({ item, moment }, index) => <View key={item.record.uri}
        onLayout={event => { rows.current[index] = { y: event.nativeEvent.layout.y, height: event.nativeEvent.layout.height }; }}>
        <Row comment={item} moment={moment} positionMs={positionMs} seek={seek} />
      </View>) : <Text style={{ color: theme.muted, fontSize: 16 * theme.scale }}>no comments yet.</Text>}
    </ScrollView>
    <Svg pointerEvents="none" width="100%" height={28} style={styles.fade}>
      <Defs><LinearGradient id="comments-fade" x1="0" y1="0" x2="0" y2="1">
        <Stop offset={0} stopColor={theme.background} stopOpacity={0} />
        <Stop offset={1} stopColor={theme.background} stopOpacity={0.9} />
      </LinearGradient></Defs>
      <Rect width="100%" height="100%" fill="url(#comments-fade)" />
    </Svg>
    <View style={styles.composer}><CommentComposer track={track} positionMs={positionMs} returnTo={returnTo} /></View>
  </View>;
}

function Row({ comment, moment, positionMs, seek }: { comment: TrackComment; moment: Moment; positionMs: number; seek?: (seconds: number) => void }) {
  const theme = useAppearance();
  const now = moment === 'now';
  const emoji = emojiOnly(comment.text);
  const stamp = clock(comment.timestamp_ms / 1000);
  const words = emoji ? (now ? 44 : 34) : now ? 25 : 19;
  return <Pressable accessibilityRole="button" accessibilityLabel={`Play from ${stamp}, comment by ${commentAuthor(comment)}: ${comment.text}`}
    accessibilityState={{ disabled: !seek, selected: now }} disabled={!seek} onPress={() => seek?.(comment.timestamp_ms / 1000)}
    style={[styles.row, { opacity: moment === 'heard' ? 0.5 : moment === 'ahead' ? 0.45 : 1 }]}>
    <Cover uri={comment.author.avatar_url} size={now ? 40 : 32} round instant />
    <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
      <View style={styles.meta}>
        <Text numberOfLines={1} style={{ flexShrink: 1, color: theme.text, fontSize: 13 * theme.scale, fontWeight: '700' }}>{commentAuthor(comment)}</Text>
        <Text style={{ color: now ? theme.accent : theme.muted, fontSize: 13 * theme.scale, fontWeight: now ? '700' : '400', fontVariant: ['tabular-nums'] }}>{stamp}</Text>
        {moment === 'ahead' && <Text style={{ color: theme.faint, fontSize: 12.5 * theme.scale, fontVariant: ['tabular-nums'] }}>in {clock((comment.timestamp_ms - positionMs) / 1000)}</Text>}
      </View>
      <Text style={{ color: theme.text, fontSize: words * theme.scale, lineHeight: words * (emoji ? 1.1 : 1.25) * theme.scale, fontWeight: emoji ? '400' : '700' }}>{comment.text}</Text>
    </View>
  </Pressable>;
}

const styles = StyleSheet.create({
  chips: { position: 'absolute', alignItems: 'flex-start', gap: 6 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44, paddingVertical: 7, paddingLeft: 7, paddingRight: 14, borderRadius: 18,
    backgroundColor: '#0c0c0cb3', borderWidth: StyleSheet.hairlineWidth, borderColor: '#ffffff33', boxShadow: '0px 6px 20px #00000040' },
  chipLarge: { gap: 12, paddingVertical: 9, paddingLeft: 9, paddingRight: 18, borderRadius: 22 },
  who: { flexDirection: 'row', alignItems: 'baseline', gap: 7 },
  view: { borderRadius: 16, overflow: 'hidden' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingLeft: 18, paddingRight: 6, paddingTop: 6 },
  close: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', gap: 12, alignItems: 'flex-start', paddingVertical: 9 },
  meta: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', gap: 8 },
  fade: { marginTop: -28 },
  composer: { paddingHorizontal: 10, paddingBottom: 10 },
});
