import { Link } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import type { Track } from './api';
import { useAppearance } from './appearance';
import { useAuth } from './auth';
import { clock } from './chapters';
import { ArrowUp } from './icons';
import { Text } from './Text';
import { toast } from './toast';
import { addComment } from './track-comments';

const MAX_BYTES = 1000;
const bytes = (text: string) => new TextEncoder().encode(text).length;

/** A comment pinned to a moment. The time follows playback until you start typing, then holds; tap it to catch up to now.
 *  A failed send keeps what you wrote. */
export function CommentComposer({ track, positionMs, returnTo }: { track: Track; positionMs: number; returnTo: string }) {
  const theme = useAppearance();
  const auth = useAuth();
  const [text, setText] = useState('');
  const [pinned, setPinned] = useState<number>();
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string>();
  const [focused, setFocused] = useState(false);
  const moment = pinned ?? positionMs;
  const size = bytes(text.trim());
  const tooLong = size > MAX_BYTES;
  const ready = !!text.trim() && !tooLong && !sending;
  const frame = { borderColor: focused ? theme.accent : theme.border, backgroundColor: theme.background };
  if (!auth.did || !auth.commenting) {
    return <Link href={{ pathname: '/login', params: { return_to: returnTo } }} asChild>
      <Pressable accessibilityRole="link" accessibilityLabel={auth.did ? 'Reconnect to comment' : 'Sign in to comment'} style={StyleSheet.flatten([styles.frame, frame])}>
        {({ hovered }: { pressed: boolean; hovered?: boolean }) => <Text style={{ color: hovered ? theme.text : theme.muted, fontSize: 14 * theme.scale, paddingHorizontal: 10 }}>
          {auth.did ? 'reconnect to comment on this track' : 'sign in to comment on this track'}
        </Text>}
      </Pressable>
    </Link>;
  }
  async function send() {
    if (!ready) return;
    setSending(true);
    setError(undefined);
    try {
      await addComment(track, text.trim(), moment);
      setText('');
      setPinned(undefined);
      toast.success(`commented at ${clock(moment / 1000)}`);
    } catch (cause) {
      setError(cause instanceof Error && cause.message ? `couldn’t post your comment: ${cause.message}` : 'couldn’t post your comment. try again.');
    } finally {
      setSending(false);
    }
  }
  return <View style={{ gap: 6 }}>
    <View style={[styles.frame, frame]}>
      <Pressable accessibilityRole="button" accessibilityLabel={pinned === undefined ? `Comment at ${clock(moment / 1000)}` : `Comment at ${clock(moment / 1000)}, move to now`}
        onPress={() => setPinned(text ? positionMs : undefined)} style={[styles.chip, { backgroundColor: `${theme.accent}22` }]}>
        <Text style={[styles.chipText, { color: theme.accent, fontSize: 13 * theme.scale }]}>at {clock(moment / 1000)}</Text>
      </Pressable>
      <TextInput value={text} accessibilityLabel={`Comment at ${clock(moment / 1000)}`} placeholder="add a comment…" placeholderTextColor={theme.faint}
        onChangeText={next => { setText(next); setError(undefined); if (!next) setPinned(undefined); else if (pinned === undefined) setPinned(positionMs); }}
        onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} onSubmitEditing={() => void send()} returnKeyType="send" submitBehavior="submit"
        editable={!sending} maxLength={MAX_BYTES * 2}
        style={[styles.input, { color: theme.text, fontFamily: theme.fontFamily, fontSize: 16 * theme.scale }]} />
      <Pressable accessibilityRole="button" accessibilityLabel="Post comment" accessibilityState={{ disabled: !ready, busy: sending }} disabled={!ready}
        onPress={() => void send()} style={[styles.send, { backgroundColor: ready ? theme.accent : theme.raised }]}>
        <ArrowUp size={16} color={ready ? theme.onAccent : theme.faint} weight="bold" />
      </Pressable>
    </View>
    {(error || tooLong) && <Text accessibilityLiveRegion="polite" style={{ color: theme.danger, fontSize: 13 * theme.scale, paddingHorizontal: 12 }}>
      {tooLong ? `that’s ${size - MAX_BYTES} characters too long` : error}
    </Text>}
  </View>;
}

const styles = StyleSheet.create({
  frame: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44, borderWidth: 1, borderRadius: 22, paddingHorizontal: 5 },
  chip: { borderRadius: 16, paddingHorizontal: 10, paddingVertical: 5, minHeight: 30, justifyContent: 'center' },
  chipText: { fontWeight: '600', fontVariant: ['tabular-nums'] },
  input: { flex: 1, minWidth: 0, minHeight: 40, paddingVertical: 8, outlineStyle: 'none' } as object,
  send: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
});
