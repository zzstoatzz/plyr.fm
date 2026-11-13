import { useEffect, useState } from 'react';
import { Image, PixelRatio, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import Svg, { Defs, LinearGradient, Path, Polygon, Stop } from 'react-native-svg';
import { useAppearance } from './appearance';
import { displayUrl } from './artwork';
import { Cover } from './CatalogPieces';
import { Copy, InlineLink, Page } from './controls';
import { playerSheet } from './player-sheet';
import { radioStations, type RadioStation } from './radio';
import { useRadio } from './radio-session';
import { Text } from './Text';
import { useRadioFeed } from './use-radio-feed';

const CUT = 10;

export default function RadioStations() {
  const radio = useRadio();
  const theme = useAppearance();
  const { width } = useWindowDimensions();
  const [frame, setFrame] = useState(0);
  const [opening, setOpening] = useState<RadioStation | null>(null);
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
  return <Page title="radio">
    <Copy>four stations, always on. pick one and listen along with everyone else.</Copy>
    <View testID="radio-stations" onLayout={event => setFrame(event.nativeEvent.layout.width)} style={{ flexDirection: 'row', flexWrap: 'wrap', gap }}>
      {size > 0 && radioStations.map(station => <StationWindow key={station.slug} station={station} size={size}
        tuned={radio.station === station} listening={radio.station === station && radio.listening} onPress={() => listen(station)} />)}
    </View>
    <Text style={{ color: theme.muted, fontFamily: theme.fontFamily, fontSize: 13 * theme.scale, lineHeight: 20 * theme.scale }}>
      streaming? any station drops into OBS as a browser source:{' '}
      {radioStations.map((station, at) => <Text key={station.slug}>
        <InlineLink href={`/embed/radio?station=${station.slug}&autoplay=1`}>{station.label}</InlineLink>{at < radioStations.length - 1 ? ', ' : ''}
      </Text>)}
    </Text>
  </Page>;
}

/** A station as a beveled glass pane over what's on air right now. */
function StationWindow({ station, size, tuned, listening, onPress }: {
  station: RadioStation; size: number; tuned: boolean; listening: boolean; onPress: () => void;
}) {
  const theme = useAppearance();
  const { snapshot, error } = useRadioFeed(station);
  const song = snapshot?.currentSong;
  useEffect(() => {
    for (const next of snapshot?.upNext ?? []) Image.prefetch(displayUrl(next, size, PixelRatio.get())).catch(() => {});
  }, [snapshot?.upNext, size]);
  const edge = `${CUT},0 ${size - CUT},0 ${size},${CUT} ${size},${size - CUT} ${size - CUT},${size} ${CUT},${size} 0,${size - CUT} 0,${CUT}`;
  const corners = `M0 0H${CUT}L0 ${CUT}Z M${size} 0V${CUT}L${size - CUT} 0Z M${size} ${size}H${size - CUT}L${size} ${size - CUT}Z M0 ${size}V${size - CUT}L${CUT} ${size}Z`;
  const now = song ? `${song.title} · ${song.artist}` : error ? 'off air for a moment' : 'tuning in…';
  return <Pressable accessibilityRole="button" accessibilityLabel={`${tuned ? 'Open' : 'Listen to'} ${station.label} radio`}
    accessibilityHint={song ? `now playing ${song.title} by ${song.artist}` : undefined} onPress={onPress}
    style={({ pressed }) => ({ width: size, gap: 8, opacity: pressed ? 0.85 : 1, transform: [{ scale: pressed ? 0.98 : 1 }] })}>
    <View style={{ width: size, height: size, backgroundColor: theme.raised }}>
      <Cover uri={song?.artwork} size={size} radius={0} />
      <Svg pointerEvents="none" width={size} height={size} style={StyleSheet.absoluteFill}>
        <Defs>
          <LinearGradient id={`sheen-${station.slug}`} x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor="#ffffff" stopOpacity={0.22} />
            <Stop offset="0.42" stopColor="#ffffff" stopOpacity={0.04} />
            <Stop offset="1" stopColor="#ffffff" stopOpacity={0} />
          </LinearGradient>
          <LinearGradient id={`rim-${station.slug}`} x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor="#ffffff" stopOpacity={0.7} />
            <Stop offset="0.5" stopColor="#ffffff" stopOpacity={0.12} />
            <Stop offset="1" stopColor="#000000" stopOpacity={0.35} />
          </LinearGradient>
        </Defs>
        <Polygon points={edge} fill={`url(#sheen-${station.slug})`} />
        <Path d={corners} fill={theme.background} />
        <Polygon points={edge} fill="none" stroke={tuned ? theme.accent : `url(#rim-${station.slug})`} strokeWidth={tuned ? 2 : 1.25} />
      </Svg>
    </View>
    <View style={{ gap: 2 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <View style={{ width: 7, height: 7, borderRadius: 3.5, backgroundColor: listening ? theme.accent : song ? theme.muted : theme.line, opacity: listening ? 1 : 0.6 }} />
        <Text numberOfLines={1} style={{ flexShrink: 1, color: theme.text, fontFamily: theme.fontFamily, fontSize: 16 * theme.scale, fontWeight: '700' }}>{station.label}</Text>
      </View>
      <Text numberOfLines={1} style={{ color: theme.muted, fontFamily: theme.fontFamily, fontSize: 13 * theme.scale }}>{now}</Text>
    </View>
  </Pressable>;
}
