import { Link } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { Track, TrackComment } from './api';
import { useAppearance } from './appearance';
import { useAuth } from './auth';
import { Cover } from './CatalogPieces';
import { clock } from './chapters';
import { CommentComposer } from './CommentComposer';
import { timeAgo } from './home-state';
import { Trash } from './icons';
import { usePlayback } from './playback';
import { passingComment } from './comment-faces';
import { ScrubberFaces, commentAuthor } from './ScrubberFaces';
import Slider from './Slider';
import { Text } from './Text';
import { toast } from './toast';
import { removeComment, useTrackComments } from './track-comments';

/** Every comment on a track in time order, under faces on a full-width scrubber. Any time you click plays from there. */
export function TrackComments({ track, play }: { track: Track; play: () => void }) {
  const theme = useAppearance();
  const player = usePlayback();
  const comments = useTrackComments(track.id);
  const current = player.current?.id === track.id;
  const duration = (current && player.status.duration) || track.metadata.duration_seconds || 0;
  const [scrub, setScrub] = useState<number>();
  const position = scrub ?? (current ? player.seekPreview ?? player.status.currentTime : 0);
  const pending = useRef<number>(undefined);
  // A time picked before this track was playing waits until its audio is actually running; a seek during loading is dropped by the restore.
  const running = current && player.status.playing && !player.loading && player.status.currentTime > 0;
  useEffect(() => {
    if (pending.current === undefined || !running) return;
    player.seek(pending.current);
    pending.current = undefined;
  }, [running, player]);
  const playFrom = (seconds: number) => {
    if (current) {
      player.seek(seconds);
      if (!player.status.playing) player.setPlaying(true);
    } else {
      pending.current = seconds;
      play();
    }
  };
  const playing = current && player.status.playing;
  const passing = playing ? passingComment(comments.comments, comment => comment.timestamp_ms, position * 1000) : undefined;
  const count = comments.comments.length;
  return <View style={styles.section}>
    <Text accessibilityRole="header" aria-level={2} style={{ color: theme.text, fontSize: 17 * theme.scale, fontWeight: '700' }}>
      comments{count ? <Text style={{ color: theme.faint, fontWeight: '400' }}> {count}</Text> : null}
    </Text>
    <View>
      <ScrubberFaces comments={comments.comments} durationMs={duration * 1000} positionMs={position * 1000} playing={playing && scrub === undefined} onSeek={ms => playFrom(ms / 1000)} />
      <Slider accessibilityLabel={`Play ${track.metadata.title} from`} minimumValue={0} maximumValue={duration || 1} value={position}
        disabled={!duration || current && !player.canSeek} onSlidingStart={setScrub} onValueChange={setScrub}
        onSlidingComplete={seconds => { setScrub(undefined); playFrom(seconds); }} />
      <View style={styles.times}>
        <Text style={[styles.numeric, { color: theme.muted, fontSize: 12 * theme.scale }]}>{clock(position)}</Text>
        <Text style={[styles.numeric, { color: theme.muted, fontSize: 12 * theme.scale }]}>{clock(duration)}</Text>
      </View>
    </View>
    <CommentComposer track={track} positionMs={position * 1000} returnTo={`/track/${track.id}`} />
    {comments.loading ? <Text style={{ color: theme.muted, fontSize: 14 * theme.scale }}>loading comments…</Text>
      : comments.error ? <View style={styles.status}>
        <Text style={{ color: theme.muted, fontSize: 14 * theme.scale }}>couldn’t load comments.</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Retry loading comments" onPress={comments.retry} style={styles.retry}>
          <Text style={{ color: theme.accent, fontSize: 14 * theme.scale, fontWeight: '600' }}>try again</Text>
        </Pressable>
      </View>
      : !count ? <Text style={{ color: theme.muted, fontSize: 14 * theme.scale }}>no comments yet. pick a moment and say something about it.</Text>
      : <View>{comments.comments.map(comment => <CommentRow key={comment.record.uri} track={track} comment={comment} passing={comment === passing} playFrom={playFrom} />)}</View>}
  </View>;
}

function CommentRow({ track, comment, passing, playFrom }: { track: Track; comment: TrackComment; passing: boolean; playFrom: (seconds: number) => void }) {
  const theme = useAppearance();
  const auth = useAuth();
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const mine = auth.did === comment.author.did && auth.commenting;
  const stamp = clock(comment.timestamp_ms / 1000);
  const name = commentAuthor(comment);
  async function remove() {
    setDeleting(true);
    try {
      await removeComment(track.id, comment);
      toast.info(`deleted your comment at ${stamp}`);
    } catch {
      toast.error('couldn’t delete your comment. try again.');
      setDeleting(false);
      setConfirming(false);
    }
  }
  const profile = comment.author.handle ? { pathname: '/u/[handle]' as const, params: { handle: comment.author.handle } } : undefined;
  return <View testID="comment-row" style={[styles.row, passing && { backgroundColor: `${theme.accent}14` }]}>
    <Cover uri={comment.author.avatar_url} size={28} round instant />
    <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
      <View style={styles.head}>
        {profile ? <Link href={profile} style={{ flexShrink: 1, color: theme.text, fontFamily: theme.fontFamily, fontSize: 13 * theme.scale, fontWeight: '600' }} numberOfLines={1}>{name}</Link>
          : <Text numberOfLines={1} style={{ flexShrink: 1, color: theme.text, fontSize: 13 * theme.scale, fontWeight: '600' }}>{name}</Text>}
        <Pressable accessibilityRole="button" accessibilityLabel={`Play from ${stamp}`} onPress={() => playFrom(comment.timestamp_ms / 1000)} hitSlop={10}>
          {({ hovered }: { pressed: boolean; hovered?: boolean }) => <Text style={[styles.numeric, { color: theme.accent, fontSize: 12 * theme.scale, fontWeight: '700', textDecorationLine: hovered ? 'underline' : 'none' }]}>{stamp}</Text>}
        </Pressable>
        <Text style={{ marginLeft: 'auto', color: theme.faint, fontSize: 12 * theme.scale }}>{timeAgo(comment.created_at)}</Text>
      </View>
      <Text selectable style={{ color: theme.text, fontSize: 14 * theme.scale, lineHeight: 20 * theme.scale }}>{comment.text}</Text>
      {confirming && <View style={styles.confirm}>
        <Text style={{ color: theme.muted, fontSize: 13 * theme.scale }}>delete this comment?</Text>
        <Pressable accessibilityRole="button" accessibilityLabel={`Delete your comment at ${stamp}`} disabled={deleting} onPress={() => void remove()} style={styles.confirmAction}>
          <Text style={{ color: theme.danger, fontSize: 13 * theme.scale, fontWeight: '600' }}>{deleting ? 'deleting…' : 'delete'}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Keep it" disabled={deleting} onPress={() => setConfirming(false)} style={styles.confirmAction}>
          <Text style={{ color: theme.text, fontSize: 13 * theme.scale, fontWeight: '600' }}>keep</Text>
        </Pressable>
      </View>}
    </View>
    {mine && !confirming && <Pressable accessibilityRole="button" accessibilityLabel={`Delete your comment at ${stamp}`} onPress={() => setConfirming(true)} style={styles.trash}>
      {({ hovered }: { pressed: boolean; hovered?: boolean }) => <Trash size={16} color={hovered ? theme.danger : theme.faint} />}
    </Pressable>}
  </View>;
}

const styles = StyleSheet.create({
  section: { alignSelf: 'stretch', gap: 12, marginTop: 12 },
  times: { flexDirection: 'row', justifyContent: 'space-between', marginTop: -4 },
  numeric: { fontVariant: ['tabular-nums'] },
  status: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  retry: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 4 },
  row: { flexDirection: 'row', gap: 12, paddingVertical: 10, paddingHorizontal: 8, marginHorizontal: -8, borderRadius: 10 },
  head: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  confirm: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 2 },
  confirmAction: { minHeight: 32, justifyContent: 'center' },
  trash: { width: 44, height: 44, marginVertical: -10, marginRight: -10, alignItems: 'center', justifyContent: 'center' },
});
