import { Link } from 'expo-router';
import { useEffect, useState } from 'react';
import { AppState, Linking, Pressable, StyleSheet, View } from 'react-native';
import { readListeningNow, type ListeningNow } from '@plyr/next-core/teal-status';
import { useAppearance } from './appearance';
import { PlayingWave } from './PlayingWave';
import { Text } from './Text';
import { toast } from './toast';

const REFRESH = 60_000;

/** what `did` is listening to according to their teal.fm status, refreshed while the screen is up */
function useListeningNow(did: string) {
  const [status, setStatus] = useState<ListeningNow | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    let refresh: ReturnType<typeof setTimeout> | undefined;
    let loading = false;
    async function load() {
      clearTimeout(refresh);
      if (loading || AppState.currentState !== 'active') return;
      loading = true;
      const next = await readListeningNow(did, { signal: controller.signal }).finally(() => { loading = false; });
      if (controller.signal.aborted) return;
      setStatus(next);
      refresh = setTimeout(load, next ? Math.min(REFRESH, Math.max(1000, next.endsAt - Date.now())) : REFRESH);
    }
    const active = AppState.addEventListener('change', state => { if (state === 'active') void load(); });
    void load();
    return () => {
      controller.abort();
      clearTimeout(refresh);
      active.remove();
    };
  }, [did]);
  return status;
}

/** a one-line "listening to" status under the artist's name */
export function ListeningNowStatus({ did, name }: { did: string; name: string }) {
  const theme = useAppearance();
  const [pressed, setPressed] = useState(false);
  const status = useListeningNow(did);
  if (!status) return null;
  const artists = status.artists.join(', ');
  const link = status.plyrTrack ? null : status.link;
  const linked = !!status.plyrTrack || !!link;
  const text = { fontFamily: theme.fontFamily, fontSize: 14 * theme.scale };
  const line = <Pressable accessibilityRole={linked ? 'link' : undefined} disabled={!linked}
    accessibilityLabel={`${name} is listening to ${status.track}${artists ? ` by ${artists}` : ''}`}
    onPress={link ? () => void Linking.openURL(link).catch(() => toast.error('couldn’t open that link')) : undefined}
    onPressIn={() => setPressed(true)} onPressOut={() => setPressed(false)}
    style={StyleSheet.flatten([styles.line, { opacity: pressed ? 0.6 : 1 }])}>
    <PlayingWave size={12} color={theme.accent} live={false} />
    <Text numberOfLines={1} style={[styles.copy, text, { color: theme.muted }]}>
      listening to <Text style={[text, { color: theme.text, fontWeight: '600' }]}>{status.track}</Text>{artists ? ` · ${artists}` : ''}
    </Text>
  </Pressable>;
  return <View style={styles.row}>
    {status.plyrTrack ? <Link href={{ pathname: '/track/[id]', params: { id: status.plyrTrack } }} asChild>{line}</Link> : line}
  </View>;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'center', marginTop: 8, maxWidth: '100%' },
  line: { flexDirection: 'row', alignItems: 'center', gap: 7, maxWidth: '100%', minHeight: 28 },
  copy: { flexShrink: 1 },
});
