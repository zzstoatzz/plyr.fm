import { Text } from '../src/Text';
import { randomUUID } from 'expo-crypto';
import { router } from 'expo-router';
import Users from 'lucide-react-native/icons/users';
import { useAuth } from '../src/auth';
import Slider from '../src/Slider';
import X from 'lucide-react-native/icons/x';
import Repeat from 'lucide-react-native/icons/repeat';
import Repeat1 from 'lucide-react-native/icons/repeat-1';
import Shuffle from 'lucide-react-native/icons/shuffle';
import Trash from 'lucide-react-native/icons/trash';
import Volume2 from 'lucide-react-native/icons/volume-2';
import { useRef, useState, type ReactNode } from 'react';
import { Pressable, type ScrollViewInstance, StyleSheet, View } from 'react-native';
import type { Track } from '../src/api';
import { useAppearance } from '../src/appearance';
import { artistName, Cover, Heading } from '../src/CatalogPieces';
import { Action, Copy, Page, row } from '../src/controls';
import { usePlayback } from '../src/playback';
import { useAppPreferences } from '../src/preference-context';
import { Sheet } from '../src/Sheet';
import { QueueReorder } from '../src/QueueReorder';

export default function Queue() {
  const player = usePlayback();
  const { did } = useAuth();
  const theme = useAppearance();
  const { preferences, setPreferences } = useAppPreferences();
  const [history, setHistory] = useState(false);
  const [dialog, setDialog] = useState<'clear' | 'volume' | null>(null);
  const [dragging, setDragging] = useState(false);
  const scrollRef = useRef<ScrollViewInstance>(null);
  const scrollMetrics = useRef({ offset: 0, height: 0, contentHeight: 0 });
  const upcoming = player.queue.slice(player.index + 1);
  const RepeatIcon = player.repeat === 'one' ? Repeat1 : Repeat;

  return <Page title="Queue" scrollRef={scrollRef} scrollEnabled={!dragging}
    onScroll={event => { scrollMetrics.current.offset = event.nativeEvent.contentOffset.y; }}
    onLayout={event => { scrollMetrics.current.height = event.nativeEvent.layout.height; }}
    onContentSizeChange={(_, height) => { scrollMetrics.current.contentHeight = height; }}>
    {player.current ? <>
      <View style={styles.section}>
        <View style={styles.header}>
          <Heading>Now playing</Heading>
          <View style={styles.actions}>
            <IconButton label={player.jam ? "Open Jam" : "Start a Jam"} selected={!!player.jam} onPress={() => {
              if (player.jam) { router.push({ pathname: '/jam/[room]', params: { room: `${player.jam.host}~${player.jam.key}` } }); return; }
              if (did && player.current) router.push({ pathname: '/jam/[room]', params: { room: `${did}~${randomUUID()}`, track: player.current.id } });
              else router.push({ pathname: '/login', params: { return_to: '/queue' } });
            }}><Users size={20} color={theme.text} /></IconButton>
            <IconButton label={`Repeat: ${player.repeat}`} disabled={!!player.jam} selected={player.repeat !== 'off'}
              onPress={() => player.setRepeat(player.repeat === 'off' ? 'all' : player.repeat === 'all' ? 'one' : 'off')}>
              <RepeatIcon size={20} color={player.repeat === 'off' ? theme.muted : theme.accent} />
            </IconButton>
            <IconButton label="Volume" onPress={() => setDialog('volume')}><Volume2 size={20} color={theme.muted} /></IconButton>
          </View>
        </View>
        <View style={{ backgroundColor: theme.surface, borderRadius: 12 }}>
          <QueueTrack track={player.current} />
        </View>
      </View>
      <View style={styles.section}>
        <View style={styles.header}>
          <Heading>Up next</Heading>
          <View style={styles.actions}>
            <IconButton label="Shuffle upcoming" disabled={upcoming.length < 2} onPress={player.shuffle}>
              <Shuffle size={20} color={theme.muted} />
            </IconButton>
            <IconButton label="Clear upcoming" disabled={!upcoming.length} onPress={() => setDialog('clear')}>
              <Trash size={20} color={theme.muted} />
            </IconButton>
          </View>
        </View>
        {upcoming.length > 1 && <Text style={{ color: theme.muted, fontSize: 13 * theme.scale, paddingHorizontal: 8, paddingBottom: 6 }}>drag the handles to reorder</Text>}
        {upcoming.length ? <QueueReorder queue={player.queue} start={player.index + 1} move={player.move}
          scrollRef={scrollRef} scrollMetrics={scrollMetrics} onDragging={setDragging}
          renderTrack={(track, index) => <QueueTrack track={track} play={() => player.jump(index)}
            remove={() => player.remove(index)} />} /> : <Copy>Nothing queued. Add tracks from their menus.</Copy>}
      </View>
      {player.index > 0 && <View style={styles.section}>
        <Pressable accessibilityRole="button" accessibilityState={{ expanded: history }} onPress={() => setHistory(!history)}
          style={{ minHeight: 44, justifyContent: 'center' }}>
          <Copy>{history ? 'Hide' : 'Show'} played tracks ({player.index})</Copy>
        </Pressable>
        {history && player.queue.slice(0, player.index).map((track, index) =>
          <QueueTrack key={`${track.id}:${index}`} track={track} play={() => player.jump(index)} />)}
      </View>}
    </> : <Copy>Pick a track to start listening.</Copy>}
    {dialog === 'clear' && <Sheet title="Clear upcoming tracks?" close={() => setDialog(null)}>
      <Copy>The current track will keep playing.</Copy>
      <View style={row}>
        <Action label="Cancel" onPress={() => setDialog(null)} />
        <Action label="Clear upcoming" primary onPress={() => { player.clear(); setDialog(null); }} />
      </View>
    </Sheet>}
    {dialog === 'volume' && <Sheet title="Volume" close={() => setDialog(null)}>
      <Slider accessibilityLabel="Volume" minimumValue={0} maximumValue={1} value={preferences.volume}
        minimumTrackTintColor={theme.accent} onSlidingComplete={(volume) => setPreferences({ volume })} />
    </Sheet>}
  </Page>;
}

function QueueTrack({ track, play, remove }: { track: Track; play?: () => void; remove?: () => void }) {
  const theme = useAppearance();
  const title = track.metadata.title;
  const artist = artistName(track);
  const contents = <>
    <Cover uri={track.media.artwork?.url} size={44} />
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
  icon: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }
});
