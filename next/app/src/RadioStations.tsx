import { useEffect, useState } from 'react';
import { Image, PixelRatio, Pressable, StyleSheet, View, } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { useAppearance } from './appearance';
import { displayUrl } from '@plyr/next-core/artwork';
import { Cover } from './CatalogPieces';
import { useLocalSearchParams } from 'expo-router';
import { Action, Copy, InlineLink, Page } from './controls';
import { playerSheet } from './player-sheet';
import { radioStationBySlug, radioStationPath, radioStations, type RadioStation } from '@plyr/next-core/radio';
import { shareLink } from './ShareLink';
import { useRadio } from './radio-session';
import { Text } from './Text';
import { useRadioFeed } from './use-radio-feed';

const RADIUS = 10;
const featured = radioStations.find(station => station.slug === 'firehose')!;
const tiled = radioStations.filter(station => station !== featured);

export default function RadioStations() {
  const radio = useRadio();
  const theme = useAppearance();
  // `/radio/{station}` is a station's shareable link; it waits for a tap, since tuning in starts audio
  const linked = radioStationBySlug(useLocalSearchParams<{ station?: string }>().station);
  const [frame, setFrame] = useState(0);
  const [opening, setOpening] = useState<RadioStation | null>(null);
  const columns = 2;
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
    width={tileWidth} height={tileHeight} tuned={radio.station === station || station === linked} listening={radio.station === station && radio.listening} onPress={() => listen(station)} />;
  const small = { color: theme.muted, fontFamily: theme.fontFamily, fontSize: 13 * theme.scale, lineHeight: 20 * theme.scale };
  return <Page title="radio">
    <Copy>always on. pick a station and listen along with everyone else.</Copy>
    {linked && <View testID="radio-linked" style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10, marginBottom: 14 }}>
      <Text style={{ color: theme.text, fontFamily: theme.fontFamily, fontWeight: '700', fontSize: 17 * theme.scale, flexGrow: 1 }}>{linked.label} radio</Text>
      {!(radio.station === linked && radio.listening) && <Action primary label="listen" onPress={() => listen(linked)} />}
      <Action label="share" onPress={() => void shareLink(radioStationPath(linked))} />
    </View>}
    <View testID="radio-stations" onLayout={event => setFrame(event.nativeEvent.layout.width)} style={{ flexDirection: 'row', flexWrap: 'wrap', gap }}>
      {size > 0 && tiled.map(station => tile(station, size, size))}
      {size > 0 && tile(featured, frame, Math.round(Math.min(size, 180) * 0.75))}
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
  const now = song?.live ? 'on air now' : song ? `${song.title} · ${song.artist}` : error ? 'off air for a moment' : 'tuning in…';
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
