import { Link } from 'expo-router';
import { useEffect, useState } from 'react';
import { AppState, Linking, Pressable, StyleSheet, View } from 'react-native';
import { listeningElapsed, readListeningNow, type ListeningNow } from '@plyr/next-core/teal-status';
import { useAppearance } from './appearance';
import { Cover } from './CatalogPieces';
import { CaretRight } from './icons';
import { PlayingWave } from './PlayingWave';
import { Text } from './Text';
import { toast } from './toast';

const REFRESH = 60_000;

function clock(value: number) {
  const seconds = Math.max(0, Math.floor(value));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/** what `did` is listening to according to their teal.fm status, refreshed while the screen is up */
function useListeningNow(did: string) {
  const [status, setStatus] = useState<ListeningNow | null>(null);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const controller = new AbortController();
    let refresh: ReturnType<typeof setTimeout> | undefined;
    let current: ListeningNow | null = null;
    async function load() {
      clearTimeout(refresh);
      if (AppState.currentState !== 'active') return;
      const next = await readListeningNow(did, { signal: controller.signal });
      if (controller.signal.aborted) return;
      current = next;
      setStatus(next);
      setNow(Date.now());
      refresh = setTimeout(load, next ? Math.min(REFRESH, Math.max(1000, next.endsAt - Date.now())) : REFRESH);
    }
    const tick = setInterval(() => {
      if (!current) return;
      setNow(Date.now());
      if (Date.now() >= current.endsAt) void load();
    }, 1000);
    const active = AppState.addEventListener('change', state => { if (state === 'active') void load(); });
    void load();
    return () => {
      controller.abort();
      clearTimeout(refresh);
      clearInterval(tick);
      active.remove();
    };
  }, [did]);
  return status && now < status.endsAt ? { status, now } : null;
}

export function ListeningNowCard({ did, name }: { did: string; name: string }) {
  const theme = useAppearance();
  const [pressed, setPressed] = useState(false);
  const listening = useListeningNow(did);
  if (!listening) return null;
  const { status, now } = listening;
  const elapsed = listeningElapsed(status, now);
  const byline = [status.artists.join(', '), status.release].filter(Boolean).join(' · ');
  const link = status.plyrTrack ? null : status.link;
  const linked = !!status.plyrTrack || !!link;
  const label = `${name} is listening to ${status.track}${status.artists.length ? ` by ${status.artists.join(', ')}` : ''}`;
  const card = <Pressable accessibilityRole={linked ? 'link' : undefined} accessibilityLabel={label} disabled={!linked}
    onPress={link ? () => void Linking.openURL(link).catch(() => toast.error('couldn’t open that link')) : undefined}
    onPressIn={() => setPressed(true)} onPressOut={() => setPressed(false)}
    style={StyleSheet.flatten([styles.card, {
      backgroundColor: theme.accent + (pressed ? '29' : '17'),
      borderColor: theme.accent + '38',
    }])}>
    <View style={styles.eyebrow}>
      <PlayingWave size={12} color={theme.accent} />
      <Text style={{ color: theme.accent, fontFamily: theme.fontFamily, fontSize: 12 * theme.scale, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase' }}>listening now</Text>
    </View>
    <View style={styles.body}>
      <View style={{ borderRadius: 8, boxShadow: '0px 4px 12px #00000038' }}><Cover uri={status.coverUrl} size={64} radius={8} /></View>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text numberOfLines={1} style={{ color: theme.text, fontFamily: theme.fontFamily, fontSize: 16 * theme.scale, fontWeight: '700' }}>{status.track}</Text>
        {byline ? <Text numberOfLines={1} style={{ color: theme.muted, fontFamily: theme.fontFamily, fontSize: 14 * theme.scale }}>{byline}</Text> : null}
        {status.duration ? <View aria-hidden style={styles.progress}>
          <Text style={[styles.time, { color: theme.faint, fontFamily: theme.fontFamily, fontSize: 12 * theme.scale }]}>{clock(elapsed)}</Text>
          <View style={[styles.bar, { backgroundColor: theme.text + '24' }]}>
            <View style={{ width: `${(elapsed / status.duration) * 100}%`, height: '100%', borderRadius: 2, backgroundColor: theme.text }} />
          </View>
          <Text style={[styles.time, { color: theme.faint, fontFamily: theme.fontFamily, fontSize: 12 * theme.scale }]}>{clock(status.duration)}</Text>
        </View> : null}
      </View>
      {linked ? <CaretRight size={14} color={theme.faint} /> : null}
    </View>
  </Pressable>;
  return status.plyrTrack ? <Link href={{ pathname: '/track/[id]', params: { id: status.plyrTrack } }} asChild>{card}</Link> : card;
}

const styles = StyleSheet.create({
  card: { gap: 10, marginTop: 16, paddingHorizontal: 14, paddingTop: 12, paddingBottom: 14, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth },
  eyebrow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  body: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  progress: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 },
  bar: { flex: 1, height: 4, borderRadius: 2, overflow: 'hidden' },
  time: { fontVariant: ['tabular-nums'] },
});
