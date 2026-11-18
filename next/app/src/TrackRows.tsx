import { Link } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import { GestureDetector } from 'react-native-gesture-handler';
import type { Track } from '@plyr/next-core/api';
import { trackArtwork } from '@plyr/next-core/artwork';
import { useAppearance } from './appearance';
import { artistName, Row, trackMeta, type Play } from './CatalogPieces';
import { formatDuration } from './home-state';
import { PlayGlyph as PlayIcon } from './PlayerGlyph';
import { PlayingWave } from './PlayingWave';
import { useTrackPlayback } from './playback-context';
import { Text } from './Text';
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

/** An album's tracks share its cover, so rows lead with the track number instead. */
export function AlbumRows({ tracks, onPlay }: { tracks: Track[]; onPlay: Play }) {
  return <View>{tracks.map((track, index) => <AlbumRow key={`${track.id}:${index}`} track={track} number={index + 1}
    onPlay={() => onPlay(track, tracks)} last={index === tracks.length - 1} />)}</View>;
}

function AlbumRow({ track, number, onPlay, last }: { track: Track; number: number; onPlay: () => void; last: boolean }) {
  const colors = useAppearance();
  const { current } = useTrackPlayback(track);
  const { row, hold, menu } = useTrackPress(track);
  return <>
    <GestureDetector gesture={hold}><View ref={row} collapsable={false}
      style={[styles.albumRow, !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.hairline }]}>
      <Link href={{ pathname: '/track/[id]', params: { id: track.id } }} asChild>
        <Pressable accessibilityRole="link" style={styles.rowLink}>
          <Text style={[styles.number, { color: current ? colors.accent : colors.faint, fontFamily: colors.fontFamily, fontSize: 15 * colors.scale }]}>{number}</Text>
          <Text numberOfLines={2} style={[styles.rowTitle, { flex: 1, color: current ? colors.accent : colors.text, fontFamily: colors.fontFamily, fontSize: 16 * colors.scale }]}>{track.metadata.title}</Text>
          <Text style={{ color: colors.faint, fontFamily: colors.fontFamily, fontSize: 14 * colors.scale, fontVariant: ['tabular-nums'] }}>{formatDuration(track.metadata.duration_seconds)}</Text>
        </Pressable>
      </Link>
      <RowPlay track={track} onPress={onPlay} />
    </View></GestureDetector>
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

const styles = StyleSheet.create({
  rows: { gap: 8 },
  albumRow: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 56, paddingLeft: 2 },
  rowLink: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 4 },
  rowTitle: { fontWeight: '600' },
  number: { width: 24, textAlign: 'right', fontVariant: ['tabular-nums'] },
});
