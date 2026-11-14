import { useEffect, useState } from 'react';
import { CaretDown as ChevronDown, Screencast as Cast } from './icons';
import { Image, PixelRatio, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { useAppearance } from './appearance';
import { displayUrl } from './artwork';
import { Cover } from './CatalogPieces';
import { Copy, InlineLink, Page } from './controls';
import { playerSheet } from './player-sheet';
import { radioStations, type RadioStation } from './radio';
import { useRadio } from './radio-session';
import { Text } from './Text';
import { useRadioFeed } from './use-radio-feed';

const RADIUS = 10;
const featured = radioStations.find(station => station.slug === 'firehose')!;
const tiled = radioStations.filter(station => station !== featured);

export default function RadioStations() {
  const radio = useRadio();
  const theme = useAppearance();
  const { width } = useWindowDimensions();
  const [frame, setFrame] = useState(0);
  const [opening, setOpening] = useState<RadioStation | null>(null);
  const [embedding, setEmbedding] = useState(false);
  const columns = width < 600 ? 2 : 4;
  const gap = 14;
  const size = frame ? Math.floor((frame - gap * (columns - 1)) / columns) : 0;
  useEffect(() => {
    if (!opening || radio.station !== opening || !radio.song) return;
    setOpening(null);
    playerSheet.expand?.();
  }, [opening, radio.station, radio.song]);
  const listen = (station: RadioStation) => {
    if (radio.station === station) { if (!radio.listening) radio.setListening(true); playerSheet.expand?.(); return; }
    radio.tune(station);
    setOpening(station);
  };
  const tile = (station: RadioStation, tileWidth: number, tileHeight: number) => <StationWindow key={station.slug} station={station}
    width={tileWidth} height={tileHeight} tuned={radio.station === station} listening={radio.station === station && radio.listening} onPress={() => listen(station)} />;
  const small = { color: theme.muted, fontFamily: theme.fontFamily, fontSize: 13 * theme.scale, lineHeight: 20 * theme.scale };
  return <Page title="radio">
    <Copy>always on. pick a station and listen along with everyone else.</Copy>
    <View testID="radio-stations" onLayout={event => setFrame(event.nativeEvent.layout.width)} style={{ flexDirection: 'row', flexWrap: 'wrap', gap }}>
      {size > 0 && tiled.map(station => tile(station, size, size))}
      {size > 0 && tile(featured, frame, Math.round(Math.min(size, 180) * (columns === 2 ? 0.75 : 1)))}
    </View>
    <View style={{ marginTop: 8, borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: theme.line }}>
      <Pressable accessibilityRole="button" aria-expanded={embedding} onPress={() => setEmbedding(open => !open)}
        style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44, opacity: pressed ? 0.7 : 1 })}>
        <Cast size={16} color={theme.muted} />
        <Text style={[small, { flex: 1 }]}>embed radio in your stream</Text>
        <ChevronDown size={16} color={theme.muted} style={{ transform: [{ rotate: embedding ? '180deg' : '0deg' }] }} />
      </Pressable>
      {embedding && <View style={{ gap: 6, paddingBottom: 14, paddingLeft: 26 }}>
        <Text style={small}>add a station to OBS as a browser source:</Text>
        {radioStations.map(station => <Text key={station.slug} style={small}>
          <InlineLink href={`/embed/radio?station=${station.slug}&autoplay=1`}>{station.label}</InlineLink>
        </Text>)}
      </View>}
    </View>
    <Text style={[small, { fontSize: 12 * theme.scale, marginBottom: 24 }]}>
      <InlineLink href="https://tangled.org/zzstoatzz.io/plyr-radio">source</InlineLink>
      {' · a sister radio, forked from '}
      <InlineLink href="https://tangled.org/okami.mom/sister-radio">Ana’s radio</InlineLink>
    </Text>
  </Page>;
}

/** A station as a rounded glass pane over what's on air right now; a wide pane puts the cover beside the station's line. */
function StationWindow({ station, width, height, tuned, listening, onPress }: {
  station: RadioStation; width: number; height: number; tuned: boolean; listening: boolean; onPress: () => void;
}) {
  const theme = useAppearance();
  const { snapshot, error } = useRadioFeed(station);
  const song = snapshot?.currentSong;
  const wide = width > height * 1.5;
  useEffect(() => {
    for (const next of snapshot?.upNext ?? []) Image.prefetch(displayUrl(next, height, PixelRatio.get())).catch(() => {});
  }, [snapshot?.upNext, height]);
  const now = song ? `${song.title} · ${song.artist}` : error ? 'off air for a moment' : 'tuning in…';
  const name = <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
    <View style={{ width: 7, height: 7, borderRadius: 3.5, backgroundColor: listening ? theme.accent : song ? theme.muted : theme.line, opacity: listening ? 1 : 0.6 }} />
    <Text numberOfLines={1} style={{ flexShrink: 1, color: theme.text, fontFamily: theme.fontFamily, fontSize: 16 * theme.scale, fontWeight: '700' }}>{station.label}</Text>
  </View>;
  const playing = <Text numberOfLines={wide ? 2 : 1} style={{ color: theme.muted, fontFamily: theme.fontFamily, fontSize: 13 * theme.scale }}>{now}</Text>;
  return <Pressable accessibilityRole="button" accessibilityLabel={`${tuned ? 'Open' : 'Listen to'} ${station.label} radio`}
    accessibilityHint={song ? `now playing ${song.title} by ${song.artist}` : undefined} onPress={onPress}
    style={({ pressed }) => ({ width, gap: 8, opacity: pressed ? 0.85 : 1, transform: [{ scale: pressed ? 0.98 : 1 }] })}>
    <View style={{ width, height, borderRadius: RADIUS, overflow: 'hidden', backgroundColor: theme.raised, flexDirection: 'row' }}>
      <Cover uri={song?.artwork} size={height} radius={0} />
      {wide && <View style={{ flex: 1, justifyContent: 'center', gap: 4, paddingHorizontal: 16 }}>
        {name}
        {'about' in station && <Text numberOfLines={1} style={{ color: theme.text, fontFamily: theme.fontFamily, fontSize: 13 * theme.scale, opacity: 0.8 }}>{station.about}</Text>}
        {playing}
      </View>}
      <Svg pointerEvents="none" width={width} height={height} style={StyleSheet.absoluteFill}>
        <Defs>
          <LinearGradient id={`sheen-${station.slug}`} x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor="#ffffff" stopOpacity={0.2} />
            <Stop offset="0.42" stopColor="#ffffff" stopOpacity={0.04} />
            <Stop offset="1" stopColor="#ffffff" stopOpacity={0} />
          </LinearGradient>
          <LinearGradient id={`rim-${station.slug}`} x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor="#ffffff" stopOpacity={0.6} />
            <Stop offset="0.5" stopColor="#ffffff" stopOpacity={0.12} />
            <Stop offset="1" stopColor="#000000" stopOpacity={0.3} />
          </LinearGradient>
        </Defs>
        <Rect x={0} y={0} width={width} height={height} rx={RADIUS} fill={`url(#sheen-${station.slug})`} />
        <Rect x={0.75} y={0.75} width={width - 1.5} height={height - 1.5} rx={RADIUS - 0.75} fill="none"
          stroke={tuned ? theme.accent : `url(#rim-${station.slug})`} strokeWidth={tuned ? 2 : 1.25} />
      </Svg>
    </View>
    {!wide && <View style={{ gap: 2 }}>{name}{playing}</View>}
  </Pressable>;
}
