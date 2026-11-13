import { useLocalSearchParams } from 'expo-router';
import { useEffect, useRef } from 'react';
import { View } from 'react-native';
import { useAppearance } from './appearance';
import { Cover } from './CatalogPieces';
import { PauseGlyph as Pause, PlayGlyph as Play } from './PlayerGlyph';
import { PlayerControl } from './PlayerControl';
import { radioStations } from './radio';
import { useRadio } from './radio-session';
import { Text } from './Text';
import { useRadioFeed } from './use-radio-feed';

/** One station as a small card, for an OBS browser source or any page that embeds it. */
export function RadioEmbed() {
  const { autoplay, station: slug } = useLocalSearchParams<{ autoplay?: string; station?: string }>();
  const station = radioStations.find(item => item.slug === slug) ?? radioStations[0];
  const theme = useAppearance();
  const radio = useRadio();
  const { snapshot, error } = useRadioFeed(station);
  const song = snapshot?.currentSong;
  const started = useRef(false);
  useEffect(() => {
    if (autoplay !== '1' || started.current || !song) return;
    started.current = true;
    radio.tune(station);
  }, [autoplay, song, radio, station]);
  const listening = radio.station === station && radio.listening;
  return <View style={{ width: '100%', maxWidth: 360, padding: 8 }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, padding: 8, borderRadius: 12, backgroundColor: theme.background }}>
      <Cover size={48} uri={song?.artwork} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ color: theme.text, fontSize: 15 * theme.scale, fontWeight: '700' }}>{song?.title ?? `${station.label} radio`}</Text>
        <Text numberOfLines={1} style={{ color: theme.muted, fontSize: 12 * theme.scale }}>
          {radio.station === station && radio.status.error ? 'couldn’t play this station' : song ? `${song.artist} · ${station.label} radio` : error || 'tuning in…'}
        </Text>
      </View>
      {song && <PlayerControl icon={listening ? Pause : Play} label={listening ? 'Pause' : 'Listen live'}
        onPress={() => radio.station === station ? radio.setListening(!listening) : radio.tune(station)} />}
    </View>
  </View>;
}
