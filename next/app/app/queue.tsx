import Slider from '@react-native-community/slider';
import Ellipsis from 'lucide-react-native/icons/ellipsis';
import Repeat from 'lucide-react-native/icons/repeat';
import Repeat1 from 'lucide-react-native/icons/repeat-1';
import Shuffle from 'lucide-react-native/icons/shuffle';
import Trash from 'lucide-react-native/icons/trash';
import Volume2 from 'lucide-react-native/icons/volume-2';
import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { Track } from '../src/api';
import { useAppearance } from '../src/appearance';
import { artistName, Cover, Heading } from '../src/CatalogPieces';
import { Action, Copy, Page, row } from '../src/controls';
import { usePlayback } from '../src/playback';
import { useAppPreferences } from '../src/preference-context';
import { Sheet } from '../src/Sheet';

export default function Queue() {
  const player = usePlayback();
  const theme = useAppearance();
  const { preferences, setPreferences } = useAppPreferences();
  const [history, setHistory] = useState(false);
  const [dialog, setDialog] = useState<'clear' | 'volume' | null>(null);
  const [selection, setSelection] = useState<{ index: number; track: Track; queue: Track[] } | null>(null);
  const upcoming = player.queue.slice(player.index + 1);
  const active = selection?.queue === player.queue && selection.index > player.index ? selection : null;
  const RepeatIcon = player.repeat === 'one' ? Repeat1 : Repeat;

  return <Page title="Queue">
    {player.current ? <>
      <View style={styles.section}>
        <View style={styles.header}>
          <Heading>Now playing</Heading>
          <View style={styles.actions}>
            <IconButton label={`Repeat: ${player.repeat}`} selected={player.repeat !== 'off'}
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
        {upcoming.length ? upcoming.map((track, offset) => {
          const index = player.index + 1 + offset;
          return <QueueTrack key={`${track.id}:${index}`} track={track} play={() => player.jump(index)}
            options={() => setSelection({ index, track, queue: player.queue })} />;
        }) : <Copy>Nothing queued. Add tracks from their menus.</Copy>}
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
    {active && <Sheet title={active.track.metadata.title} close={() => setSelection(null)}>
      <Action label="Move up" disabled={active.index === player.index + 1}
        onPress={() => { player.move(active.index, active.index - 1); setSelection(null); }} />
      <Action label="Move down" disabled={active.index === player.queue.length - 1}
        onPress={() => { player.move(active.index, active.index + 1); setSelection(null); }} />
      <Action label="Remove from queue" onPress={() => { player.remove(active.index); setSelection(null); }} />
    </Sheet>}
  </Page>;
}

function QueueTrack({ track, play, options }: { track: Track; play?: () => void; options?: () => void }) {
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
    {options && <IconButton label={`Queue options for ${title}`} onPress={options}><Ellipsis size={22} color={theme.muted} /></IconButton>}
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
