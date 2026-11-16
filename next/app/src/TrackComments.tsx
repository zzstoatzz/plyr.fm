import { Link } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { Track, TrackComment } from '@plyr/next-core/api';
import { useAppearance } from './appearance';
import { useAuth } from './auth';
import { Cover } from './CatalogPieces';
import { clock } from '@plyr/next-core/chapters';
import { CommentComposer } from './CommentComposer';
import { timeAgo } from './home-state';
import { Trash } from './icons';
import { usePlayback } from './playback';
import { passingComment } from './comment-faces';
import { commentAuthor } from './ScrubberFaces';
import { Text } from './Text';
import { toast } from './toast';
import { removeComment, useTrackComments } from './track-comments';

export function TrackComments({ track }: { track: Track }) {
  const theme = useAppearance();
  const player = usePlayback();
  const comments = useTrackComments(track.id);
  const current = player.current?.id === track.id;
  const positionMs = current ? player.status.currentTime * 1000 : 0;
  const seek = current && player.status.isLoaded && player.canSeek ? player.seek : undefined;
  const passing = current && player.status.playing
    ? passingComment(comments.comments, comment => comment.timestamp_ms, positionMs) : undefined;
  const count = comments.comments.length;
  return <View style={styles.section}>
    <Text accessibilityRole="header" aria-level={2} style={{ color: theme.text, fontSize: 17 * theme.scale, fontWeight: '700' }}>
      comments{count ? <Text style={{ color: theme.faint, fontWeight: '400' }}> {count}</Text> : null}
    </Text>
    {comments.loading ? <Text style={{ color: theme.muted, fontSize: 14 * theme.scale }}>loading comments…</Text>
      : comments.error ? <View style={styles.status}>
        <Text style={{ color: theme.muted, fontSize: 14 * theme.scale }}>couldn’t load comments.</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Retry loading comments" onPress={comments.retry} style={styles.retry}>
          <Text style={{ color: theme.accent, fontSize: 14 * theme.scale, fontWeight: '600' }}>try again</Text>
        </Pressable>
      </View>
      : !count ? <Text style={{ color: theme.muted, fontSize: 14 * theme.scale }}>no comments yet.</Text>
      : <View style={styles.thread}>{comments.comments.map(comment => <CommentRow key={comment.record.uri} track={track} comment={comment} passing={comment === passing} seek={seek} />)}</View>}
    <CommentComposer track={track} positionMs={positionMs} returnTo={`/track/${track.id}`} />
  </View>;
}

function CommentRow({ track, comment, passing, seek }: { track: Track; comment: TrackComment; passing: boolean; seek?: (seconds: number) => void }) {
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
  const time = <Text style={[styles.numeric, { color: seek ? theme.accent : theme.muted, fontSize: 12 * theme.scale, fontWeight: '700' }]}>{stamp}</Text>;
  return <View testID="comment-row" style={[styles.row, { backgroundColor: passing ? theme.raised : theme.surface }]}>
    {seek ? <Pressable accessibilityRole="button" accessibilityLabel={`Seek to ${stamp}`} style={styles.timestamp}
      onPress={() => seek(comment.timestamp_ms / 1000)}>{time}</Pressable>
      : <View style={styles.timestamp}>{time}</View>}
    <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
      <View style={styles.head}>
        <Cover uri={comment.author.avatar_url} size={22} round instant />
        {profile ? <Link href={profile} style={{ flexShrink: 1, color: theme.text, fontFamily: theme.fontFamily, fontSize: 13 * theme.scale, fontWeight: '600' }} numberOfLines={1}>{name}</Link>
          : <Text numberOfLines={1} style={{ flexShrink: 1, color: theme.text, fontSize: 13 * theme.scale, fontWeight: '600' }}>{name}</Text>}
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
  thread: { gap: 8 },
  timestamp: { minWidth: 44, minHeight: 44, paddingHorizontal: 4, justifyContent: 'center', alignItems: 'center' },
  numeric: { fontVariant: ['tabular-nums'] },
  status: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  retry: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 4 },
  row: { flexDirection: 'row', gap: 6, padding: 10, borderRadius: 10 },
  head: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  confirm: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 2 },
  confirmAction: { minHeight: 32, justifyContent: 'center' },
  trash: { width: 44, height: 44, marginVertical: -10, alignItems: 'center', justifyContent: 'center' },
});
