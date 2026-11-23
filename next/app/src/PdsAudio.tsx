import { useEffect, useState, useSyncExternalStore } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { catalogChanged } from '@plyr/next-core/catalog/changes';
import { pdsEndpoint } from '@plyr/next-core/identity';
import { trackIdFromUri } from '@plyr/next-core/record-ids';
import type { AudioGap } from '@plyr/next-core/publishing/pds-audio-gaps';
import { apology, createPdsAudioStore, gapReason, gapSize, movingCopy, offerCopy, resultCopy, sheetCopy } from '@plyr/next-core/publishing/pds-audio-store';
import { getAuth, subscribeAuth, useAuth } from './auth-state';
import { NSID } from './config';
import { readLocal, writeLocal } from './storage';
import { useAppearance } from './appearance';
import { Cover } from './CatalogPieces';
import { Check, CloudArrowUp, Info, UploadSimple, X } from './icons';
import { Sheet } from './Sheet';
import { Text } from './Text';

/** Audio of yours that isn't on your PDS; shared by the sign-in ask and the card on the you tab. */
const store = createPdsAudioStore({
  getAuth, subscribeAuth,
  collection: NSID.track as `${string}.${string}.${string}`,
  pdsEndpoint,
  storage: { read: readLocal, write: writeLocal },
  onMoved: did => catalogChanged(did, 'tracks')
});

const usePdsAudio = () => useSyncExternalStore(store.subscribe, () => store.snapshot, () => store.snapshot);

const ok = '#3fae6a';

function GapRows({ gaps }: { gaps: AudioGap[] }) {
  const theme = useAppearance();
  const { rows } = usePdsAudio();
  const small = (color: string) => ({ color, fontFamily: theme.fontFamily, fontSize: 13 * theme.scale });
  return <View style={{ borderTopWidth: StyleSheet.hairlineWidth, borderColor: theme.hairline }}>
    {gaps.map(gap => {
      const row = rows[gap.uri];
      const percent = Math.round((row?.progress ?? 0) * 100);
      return <View key={gap.uri} accessible accessibilityLabel={`${gap.title}, ${gapReason(gap)}`}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: theme.hairline }}>
        <Cover uri={gap.imageUrl} size={36} radius={7} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={{ color: theme.text, fontFamily: theme.fontFamily, fontSize: 15 * theme.scale, fontWeight: '700' }}>{gap.title}</Text>
          <Text numberOfLines={1} style={small(theme.faint)}>{gapReason(gap)}{gap.sizeBytes !== undefined ? ` · ${gapSize(gap.sizeBytes)}` : ''}</Text>
        </View>
        {gap.tooBig || row?.state === 'too-big' ? <Text style={small(theme.muted)}>stays on plyr.fm</Text>
          : row?.state === 'moved' ? <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}><Check size={15} color={ok} /><Text style={small(ok)}>on your PDS</Text></View>
          : row?.state === 'already' ? <Text style={small(theme.muted)}>nothing to move</Text>
          : row?.state === 'moving' ? <View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: percent }} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <View style={{ width: 64, height: 4, borderRadius: 2, backgroundColor: theme.line, overflow: 'hidden' }}><View style={{ width: `${percent}%`, height: 4, backgroundColor: theme.accent }} /></View>
              <Text style={small(theme.muted)}>{percent >= 100 ? 'saving' : `${percent}%`}</Text>
            </View>
          : row?.state === 'waiting' ? <Text style={small(theme.muted)}>waiting</Text>
          : row?.state === 'no-copy' ? <Pressable accessibilityRole="link" hitSlop={8} onPress={() => router.push(`/edit-track/${trackIdFromUri(gap.uri)}`)}><Text style={small(theme.accent)}>replace the audio</Text></Pressable>
          : row?.state === 'failed' ? <Text style={small(theme.muted)}>didn't move</Text>
          : null}
      </View>;
    })}
  </View>;
}

function MoveButton({ label, onPress }: { label: string; onPress: () => void }) {
  const theme = useAppearance();
  return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress}
    style={({ pressed }) => ({ flex: 1, minHeight: 46, borderRadius: 12, backgroundColor: theme.accent, opacity: pressed ? 0.85 : 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 })}>
    <UploadSimple size={18} color={theme.onAccent} />
    <Text style={{ color: theme.onAccent, fontFamily: theme.fontFamily, fontSize: 16 * theme.scale, fontWeight: '700' }}>{label}</Text>
  </Pressable>;
}

function QuietButton({ label, onPress }: { label: string; onPress: () => void }) {
  const theme = useAppearance();
  return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} hitSlop={6}
    style={({ pressed }) => ({ minHeight: 44, paddingHorizontal: 12, borderRadius: 10, justifyContent: 'center', alignItems: 'center', backgroundColor: pressed ? theme.hover : 'transparent' })}>
    <Text style={{ color: theme.muted, fontFamily: theme.fontFamily, fontSize: 15 * theme.scale, fontWeight: '700' }}>{label}</Text>
  </Pressable>;
}

/** On the you tab while something of yours isn't on your PDS, then the move's progress and outcome. */
export function PdsAudioCard() {
  const theme = useAppearance();
  const audio = usePdsAudio();
  const [whyOpen, setWhyOpen] = useState(false);
  if (!audio.showCard) return null;
  const title = (value: string) => <Text style={{ color: theme.text, fontFamily: theme.fontFamily, fontSize: 17 * theme.scale, fontWeight: '800' }}>{value}</Text>;
  const detail = (value: string) => <Text style={{ color: theme.muted, fontFamily: theme.fontFamily, fontSize: 14 * theme.scale, lineHeight: 19 * theme.scale }}>{value}</Text>;
  const badge = (done = false) => <View style={[styles.badge, { backgroundColor: done ? ok + '26' : theme.accent + '2e' }]}>
    {done ? <Check size={21} color={ok} /> : <CloudArrowUp size={21} color={theme.accent} />}
  </View>;
  let body;
  if (audio.moving) {
    const copy = movingCopy(audio);
    body = <>
      <View style={styles.top}>{badge()}<View style={styles.words}>{title(copy.title)}{detail(copy.detail)}</View></View>
      <GapRows gaps={audio.gaps} />
    </>;
  } else if (audio.finished) {
    const result = resultCopy(audio);
    body = <>
      <View style={styles.top}>{badge(result.allMoved)}<View style={styles.words}>{title(result.title)}{result.detail ? detail(result.detail) : null}</View>
        {result.allMoved && <Pressable accessibilityRole="button" accessibilityLabel="close" onPress={store.close} hitSlop={8} style={{ width: 36, height: 36, alignItems: 'center', justifyContent: 'center' }}><X size={16} color={theme.muted} /></Pressable>}
      </View>
      {!result.allMoved && <>
        <GapRows gaps={audio.gaps} />
        <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 4 }}>
          {result.retry && <QuietButton label="try again" onPress={() => void store.moveAll()} />}
          <QuietButton label="done" onPress={store.close} />
        </View>
      </>}
    </>;
  } else {
    const copy = offerCopy(audio.fixable.length);
    body = <>
      <View style={styles.top}>{badge()}<View style={styles.words}>{title(copy.title)}{detail(copy.detail)}</View></View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <MoveButton label={audio.fixable.length === 1 ? 'move it' : 'move them'} onPress={() => void store.moveAll()} />
        <QuietButton label="not now" onPress={store.dismiss} />
      </View>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: whyOpen }} accessibilityLabel={whyOpen ? apology : 'why did this happen?'} onPress={() => setWhyOpen(open => !open)}
        style={{ flexDirection: 'row', gap: 6, alignItems: 'flex-start', minHeight: 32, paddingTop: 4 }}>
        <Info size={15} color={theme.faint} />
        <Text style={{ flex: 1, color: whyOpen ? theme.faint : theme.muted, fontFamily: theme.fontFamily, fontSize: 13 * theme.scale, textDecorationLine: whyOpen ? 'none' : 'underline' }}>{whyOpen ? apology : 'why did this happen?'}</Text>
      </Pressable>
    </>;
  }
  return <View accessibilityLiveRegion="polite" style={[styles.card, { borderColor: theme.accent + '57', backgroundColor: theme.surface }]}>{body}</View>;
}

/**
 * Checks once per sign-in, and asks once per account on this device when something is missing.
 * After that the card on the you tab carries it. Mount once, at the root.
 */
export function PdsAudioHost() {
  const theme = useAppearance();
  const auth = useAuth();
  const audio = usePdsAudio();
  const [open, setOpen] = useState(false);
  useEffect(() => { if (auth.ready && auth.did && auth.rpc) void store.check(); }, [auth.ready, auth.did, auth.rpc]);
  useEffect(() => { if (audio.showSheet) setOpen(true); }, [audio.showSheet]);
  const close = () => { store.markAsked(); setOpen(false); };
  if (!open) return null;
  const copy = sheetCopy(audio.fixable.length);
  return <Sheet title={copy.title} close={close} visible={open}>
    <View style={{ gap: 12, paddingHorizontal: 4, paddingBottom: 8 }}>
      <Text style={{ color: theme.muted, fontFamily: theme.fontFamily, fontSize: 15 * theme.scale, lineHeight: 21 * theme.scale }}>{copy.detail}</Text>
      <View style={{ flexDirection: 'row', gap: 6, alignItems: 'flex-start' }}>
        <Info size={15} color={theme.faint} />
        <Text style={{ flex: 1, color: theme.faint, fontFamily: theme.fontFamily, fontSize: 13 * theme.scale }}>{apology}</Text>
      </View>
      <GapRows gaps={audio.gaps} />
      <View style={{ flexDirection: 'row' }}>
        <MoveButton label={`move ${audio.fixable.length === 1 ? 'it' : 'them'} to your PDS`} onPress={() => {
          close();
          void store.moveAll();
          router.navigate('/(main)/(you)/portal');
        }} />
      </View>
      <QuietButton label="not now" onPress={close} />
    </View>
  </Sheet>;
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 14, padding: 14, gap: 12 },
  top: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  words: { flex: 1, minWidth: 0, gap: 2 },
  badge: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' }
});
