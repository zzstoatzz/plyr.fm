import { Text } from './Text';
import { PlayingWave } from './PlayingWave';
import { Users, X, Repeat, RepeatOnce as Repeat1, Shuffle, Trash, SpeakerHigh as Volume2 } from './icons';
import { randomUUID } from 'expo-crypto';
import { router } from 'expo-router';
import { useAuth } from './auth';
import Slider from './Slider';
import { useState, type ReactNode, type RefObject } from 'react';
import { Pressable, type ScrollViewInstance, StyleSheet, View } from 'react-native';
import type { Track } from '@plyr/next-core/api';
import { useAppearance } from './appearance';
import { trackArtwork } from '@plyr/next-core/artwork';
import { artistName, Cover, Heading } from './CatalogPieces';
import { Action, Copy, InlineLink, row } from './controls';
import { usePlayback } from './playback';
import { useAppPreferences } from './preference-context';
import { Sheet } from './Sheet';
import { QueueReorder, type ScrollMetrics } from './QueueReorder';
import { QueueStarters, QueueSuggestionStrips } from './QueueSuggestions';
import { BLEED, HeroBackdrop, TOP } from './HeroPieces';

/** Now playing, up next and played tracks: the queue screen on phones and the queue panel on desktop share it. */
export function QueueContent({ scrollRef, scrollMetrics, onDragging, returnTo = '/queue' }: {
  scrollRef: RefObject<ScrollViewInstance | null>; scrollMetrics: RefObject<ScrollMetrics>; onDragging: (dragging: boolean) => void; returnTo?: string;
}) {
  const player = usePlayback();
  const { did } = useAuth();
  const theme = useAppearance();
  const { preferences, setPreferences } = useAppPreferences();
  const [history, setHistory] = useState(false);
  const [dialog, setDialog] = useState<'clear' | 'volume' | null>(null);
  const upcoming = player.queue.slice(player.index + 1);
  const picks = Math.max(0, (player.tail?.from ?? player.queue.length) - player.index - 1);
  const RepeatIcon = player.repeat === 'one' ? Repeat1 : Repeat;

  return <>
    {player.queueError && <Copy>{player.queueError}</Copy>}
    {player.current ? <>
      {trackArtwork(player.current) ? <View pointerEvents="none" style={{ position: 'absolute', top: -TOP - 60, left: -BLEED, right: -BLEED }}>
        <HeroBackdrop uri={trackArtwork(player.current)!} height={460} />
      </View> : null}
      <View style={styles.section}>
        <View style={styles.header}>
          <Heading>now playing</Heading>
          <View style={styles.actions}>
            {!player.privatePlayback && <IconButton label={player.jam ? "Open Jam" : "Start a Jam"} selected={!!player.jam} onPress={() => {
              if (player.jam) { router.push({ pathname: '/jam/[room]', params: { room: `${player.jam.host}~${player.jam.key}` } }); return; }
              if (did && player.current) router.push({ pathname: '/jam/[room]', params: { room: `${did}~${randomUUID()}`, track: player.current.id } });
              else router.push({ pathname: '/login', params: { return_to: returnTo } });
            }}><Users size={20} color={theme.text} /></IconButton>}
            <IconButton label={`Repeat: ${player.repeat}`} disabled={!!player.jam} selected={player.repeat !== 'off'}
              onPress={() => player.setRepeat(player.repeat === 'off' ? 'all' : player.repeat === 'all' ? 'one' : 'off')}>
              <RepeatIcon size={20} color={player.repeat === 'off' ? theme.muted : theme.accent} />
            </IconButton>
            <IconButton label="Volume" onPress={() => setDialog('volume')}><Volume2 size={20} color={theme.muted} /></IconButton>
          </View>
        </View>
        <NowPlayingHero track={player.current} playing={player.status.playing} />
      </View>
      <View style={styles.section}>
        {player.privatePlayback && <Copy>this queue stays on this device and is not shared with jams.</Copy>}
        {player.deviceQueue && <Copy>this sign-in keeps your queue on this device. <InlineLink href={`/login?return_to=${encodeURIComponent(returnTo)}`}>sign in again</InlineLink> to sync it to your account.</Copy>}
        {player.outputElsewhere && <Copy>playing on another device. press play to listen here.</Copy>}
        <View style={styles.header}>
          <Heading>up next</Heading>
          <View style={styles.actions}>
            <IconButton label="Shuffle upcoming" disabled={picks < 2 && !player.jam} onPress={player.shuffle}>
              <Shuffle size={20} color={theme.muted} />
            </IconButton>
            <IconButton label="Clear upcoming" disabled={!(player.jam ? upcoming.length : picks)} onPress={() => setDialog('clear')}>
              <Trash size={20} color={theme.muted} />
            </IconButton>
          </View>
        </View>
        {upcoming.length > 1 && <Text style={{ color: theme.muted, fontSize: 13 * theme.scale, paddingHorizontal: 8, paddingBottom: 6 }}>hold a track to move it, or swipe it away</Text>}
        {!upcoming.length && !player.privatePlayback && !player.jam && !player.live ? <QueueStarters />
          : upcoming.length ? <View style={[styles.glass, { backgroundColor: translucent(theme.surface), borderColor: theme.border }]}><QueueReorder queue={player.queue} start={player.index + 1} move={player.move} remove={player.remove}
          scrollRef={scrollRef} scrollMetrics={scrollMetrics} onDragging={onDragging}
          renderHeader={index => player.tail && index === Math.max(player.index + 1, player.tail.from)
            ? <View style={{ paddingVertical: 8 }}><Copy>from {player.tail.label}</Copy></View> : null}
          renderTrack={(track, index) => <QueueTrack track={track} play={() => player.jump(index)} remove={() => player.remove(index)} />} /></View>
          : <Copy>nothing queued. add tracks from their menus.</Copy>}
      </View>
      {upcoming.length > 0 && !player.privatePlayback && !player.live && <QueueSuggestionStrips />}
      {player.index > 0 && <View style={styles.section}>
        <Pressable accessibilityRole="button" accessibilityState={{ expanded: history }} onPress={() => setHistory(!history)}
          style={{ minHeight: 44, justifyContent: 'center' }}>
          <Copy>{history ? 'hide' : 'show'} played tracks ({player.index})</Copy>
        </Pressable>
        {history && player.queue.slice(0, player.index).map((track, index) =>
          <QueueTrack key={`${track.id}:${index}`} track={track} play={() => player.jump(index)} />)}
      </View>}
    </> : player.privatePlayback ? <Copy>pick a track to start listening.</Copy> : <QueueStarters />}
    {dialog === 'clear' && <Sheet title="clear upcoming tracks?" close={() => setDialog(null)}>
      <Copy>{player.jam ? "the current track will keep playing." : "clear your picks. tracks from the current collection will remain."}</Copy>
      <View style={row}>
        <Action label="Cancel" onPress={() => setDialog(null)} />
        <Action label="Clear upcoming" primary onPress={() => { player.clear(); setDialog(null); }} />
      </View>
    </Sheet>}
    {dialog === 'volume' && <Sheet title="volume" close={() => setDialog(null)}>
      <Slider accessibilityLabel="Volume" minimumValue={0} maximumValue={1} value={preferences.volume}
        minimumTrackTintColor={theme.accent} onSlidingComplete={(volume) => setPreferences({ volume })} />
    </Sheet>}
  </>;
}

/** The surface colour at about two-thirds strength, so the cover wash shows through the list. */
function translucent(color: string) {
  return /^#[0-9a-f]{6}$/i.test(color) ? color + 'a8' : color;
}

function NowPlayingHero({ track, playing }: { track: Track; playing: boolean }) {
  const theme = useAppearance();
  const player = usePlayback();
  return <View style={styles.hero}>
    <Pressable accessibilityRole="button" accessibilityLabel={`${playing ? 'Pause' : 'Play'} ${track.metadata.title}`} onPress={player.toggle}
      style={({ pressed }) => ({ opacity: pressed ? 0.8 : 1 })}>
      <Cover uri={trackArtwork(track)} size={132} radius={12} />
    </Pressable>
    <View style={{ flex: 1, minWidth: 0, gap: 3, paddingBottom: 4 }}>
      {playing && <PlayingWave color={theme.accent} />}
      <Text numberOfLines={3} style={{ color: theme.text, fontFamily: theme.fontFamily, fontSize: 22 * theme.scale, lineHeight: 26 * theme.scale, fontWeight: '700' }}>{track.metadata.title}</Text>
      <Text numberOfLines={1} style={{ color: theme.muted, fontFamily: theme.fontFamily, fontSize: 15 * theme.scale }}>{artistName(track)}</Text>
    </View>
  </View>;
}

function QueueTrack({ track, play, remove }: { track: Track; play?: () => void; remove?: () => void }) {
  const theme = useAppearance();
  const title = track.metadata.title;
  const artist = artistName(track);
  const contents = <>
    <Cover uri={trackArtwork(track)} size={44} />
    <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
      <Text numberOfLines={1} style={{ color: theme.text, fontFamily: theme.fontFamily, fontSize: 15 * theme.scale, fontWeight: '600' }}>{title}</Text>
      <Text numberOfLines={1} style={{ color: theme.muted, fontFamily: theme.fontFamily, fontSize: 13 * theme.scale }}>{artist}</Text>
    </View>
  </>;
  return <View style={styles.trackRow}>
    {play ? <Pressable accessibilityRole="button" accessibilityLabel={`Play ${title} by ${artist}`} onPress={play}
      style={({ pressed }) => [styles.track, { opacity: pressed ? 0.65 : 1 }]}>{contents}</Pressable>
      : <View style={styles.track}>{contents}</View>}
    {remove && <IconButton label={`Remove ${title} from queue`} onPress={remove}><X size={18} color={theme.muted} /></IconButton>}
  </View>;
}

function IconButton({ label, selected, disabled, onPress, children }: {
  label: string; selected?: boolean; disabled?: boolean; onPress: () => void; children: ReactNode;
}) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected, disabled }}
    disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.icon, { opacity: disabled ? 0.35 : pressed ? 0.65 : 1 }]}>
    {children}
  </Pressable>;
}

const styles = StyleSheet.create({
  section: { gap: 4 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  actions: { flexDirection: 'row' },
  trackRow: { flexDirection: 'row', alignItems: 'center' },
  track: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 6, paddingHorizontal: 8 },
  icon: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  hero: { flexDirection: 'row', alignItems: 'flex-end', gap: 14, paddingVertical: 4 },
  glass: { borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, paddingVertical: 4 }
});
