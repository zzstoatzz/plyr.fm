import { Pressable, StyleSheet, View } from 'react-native';
import { GestureDetector } from 'react-native-gesture-handler';
import type { Track } from '@plyr/next-core/api';
import { trackArtwork } from '@plyr/next-core/artwork';
import { useAppearance } from './appearance';
import { artistName, Row, trackMeta, type Play } from './CatalogPieces';
import { PlayGlyph as PlayIcon } from './PlayerGlyph';
import { PlayingWave } from './PlayingWave';
import { useTrackPlayback } from './playback-context';
import { useTrackPress } from './TrackPress';

export function TrackRows({ tracks, onPlay }: { tracks: Track[]; onPlay: Play }) {
  return <View style={styles.rows}>{tracks.map((track, index) => <TrackRow key={`${track.id}:${index}`} track={track} onPlay={() => onPlay(track, tracks)} />)}</View>;
}

function TrackRow({ track, onPlay }: { track: Track; onPlay: () => void }) {
  const { row, hold, menu } = useTrackPress(track);
  return <>
    <GestureDetector gesture={hold}><View collapsable={false}><Row rowRef={row}
      href={{ pathname: '/track/[id]', params: { id: track.id } }}
      title={track.metadata.title}
      subtitle={artistName(track)}
      meta={trackMeta(track)}
      image={trackArtwork(track)}
      action={<RowPlay track={track} onPress={onPlay} />}
    /></View></GestureDetector>
    {menu}
  </>;
}

function RowPlay({ track, onPress }: { track: Track; onPress: () => void }) {
  const colors = useAppearance();
  const { playing, toggle } = useTrackPlayback(track);
  return <Pressable accessibilityRole="button" accessibilityLabel={`${playing ? 'Pause' : 'Play'} ${track.metadata.title}`} onPress={() => toggle(onPress)}
    style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
    {playing ? <PlayingWave color={colors.accent} /> : <PlayIcon size={20} color={colors.text} fill={colors.text} />}
  </Pressable>;
}

const styles = StyleSheet.create({ rows: { gap: 8 } });
