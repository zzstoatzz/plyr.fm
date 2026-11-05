import Play from 'lucide-react-native/icons/play';
import Pause from 'lucide-react-native/icons/pause';
import { PlayerControl } from './PlayerControl';
import { useAppearance } from './appearance';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { router, useLocalSearchParams } from 'expo-router';
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { Cover } from './CatalogPieces';
import { Action, Copy, Page, row } from './controls';
import { usePlayback } from './playback';
import { useAppPreferences } from './preference-context';
import { radioMedia, radioPosition, radioStations } from './radio';
import { usePlayerAccounting } from './use-player-accounting';
import { useRadioFeed } from './use-radio-feed';

type Station = typeof radioStations[number];
export const RadioContext = createContext<{ station: Station | null; tune: (station: Station | null) => void }>({ station: null, tune: () => {} });

export default function Radio({ compact = false, tuned }: { compact?: boolean; tuned?: Station }) {
  const { autoplay, station: stationSlug } = useLocalSearchParams<{ autoplay?: string; station?: string }>();
  const theme = useAppearance();
  const live = useContext(RadioContext);
  const autoTuned = useRef(false);
  const [station, setStation] = useState<typeof radioStations[number]>(() => tuned ?? radioStations.find(item => item.slug === stationSlug) ?? radioStations[0]);
  const { snapshot, error } = useRadioFeed(station);
  const [listening, setListening] = useState(false);
  const audio = useAudioPlayer(null);
  const status = useAudioPlayerStatus(audio);
  const accounting = usePlayerAccounting(audio);
  const solo = usePlayback();
  const { preferences } = useAppPreferences();
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const song = snapshot?.currentSong;
  const source = song ? radioMedia(station, song, 'audio') : null;

  useEffect(() => {
    return () => {
      audio.pause();
      setListening(false);
    };
  }, [audio, station]);

  useEffect(() => {
    audio.volume = preferences.volume;
  }, [audio, preferences.volume]);

  useEffect(() => {
    accounting.stop();
    audio.pause();
    audio.replace(compact ? source : null);
  }, [accounting, audio, compact, source]);

  useEffect(() => {
    if (!listening || !song || !source) return;
    accounting.begin(song.id.startsWith('trk_') ? song.id : `radio:${song.id}`, song.durationSeconds);
    return () => accounting.stop();
  }, [accounting, listening, song?.id, song?.durationSeconds, snapshot?.state.startedAt, source]);

  useEffect(() => {
    if ((!tuned && autoplay !== '1') || autoTuned.current || !source || snapshot?.state.status !== 'playing') return;
    if (solo.status.playing || solo.loading) return;
    autoTuned.current = true;
    if (compact) setListening(true);
    else live.tune(station);
  }, [autoplay, compact, tuned, live.tune, station, snapshot?.state.status, solo.loading, solo.status.playing, source]);

  useEffect(() => {
    if (status.error) setListening(false);
  }, [status.error]);

  useEffect(() => {
    if (solo.status.playing || solo.loading) {
      setListening(false);
      if (tuned) live.tune(null);
    }
  }, [solo.status.playing, solo.loading, tuned, live.tune]);

  useEffect(() => {
    if (!listening || !source || snapshot?.state.status !== 'playing') {
      audio.pause();
      return;
    }
    if (!status.isLoaded) {
      audio.play();
      return;
    }
    const latest = snapshotRef.current;
    if (latest) {
      const target = radioPosition(latest);
      if (Math.abs(audio.currentTime - target) > 2) void accounting.seekTo(target);
    }
    if (!audio.playing) audio.play();
  }, [audio, listening, snapshot, source, status.isLoaded]);

  if (compact) return <View style={{ width: '100%', maxWidth: tuned ? undefined : 360, padding: 8, gap: 6 }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, padding: 8, borderRadius: 12, backgroundColor: theme.background }}>
      <Cover size={48} uri={song?.hasCover ? radioMedia(station, song, 'cover') : null} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ color: theme.text, fontSize: 15, fontWeight: '700' }}>{song?.title ?? station.label}</Text>
        <Text numberOfLines={1} style={{ color: theme.muted, fontSize: 12 }}>
          {status.error ? 'Couldn’t play this station' : error || (song ? `${song.artist} · Radio` : snapshot ? 'Off air' : 'Loading station…')}
        </Text>
      </View>
      {(song || tuned) && <PlayerControl icon={listening || tuned ? Pause : Play} label={listening || tuned ? 'Stop listening' : 'Listen live'}
        onPress={() => tuned ? live.tune(null) : setListening(!listening)} />}
    </View>
  </View>;

  const artwork = song?.hasCover ? radioMedia(station, song, 'cover') : null;
  return <Page title="Radio">
    <Copy>Choose a station</Copy>
    <View style={row}>
      {radioStations.map(item => <Action key={item.slug} label={item.label} selected={item === station} primary={item === station}
        onPress={() => {
          if (item === station) return;
          setStation(item);
          router.setParams({ station: item.slug });
        }} />)}
    </View>
    <View style={{ height: 320, overflow: 'hidden', borderRadius: 20, justifyContent: 'flex-end', backgroundColor: '#141421' }}>
      {artwork && <Image source={{ uri: artwork }} resizeMode="cover" style={{ ...StyleSheet.absoluteFill, width: '100%', height: '100%' }} />}
      <View style={{ ...StyleSheet.absoluteFill, backgroundColor: 'rgba(10, 10, 20, 0.50)' }} />
      <View style={{ gap: 8, padding: 20 }}>
        <Text accessibilityRole="header" style={{ color: '#fff', fontSize: 28, fontWeight: '800' }}>{station.label}</Text>
        {song && <>
          <Text numberOfLines={2} style={{ color: '#fff', fontSize: 20, fontWeight: '700' }}>{song.title}</Text>
          <Text style={{ color: '#fff' }}>{song.artist}</Text>
        </>}
        {(!song || error || status.error) && <Text accessibilityLiveRegion="polite" style={{ color: '#fff' }}>
          {status.error ? 'Couldn’t play this station.' : error || (snapshot ? 'This station is off air.' : 'Loading station…')}
        </Text>}
        <View style={row}>
          <Action primary label={live.station === station ? 'Stop listening' : 'Listen live'} disabled={!song || solo.loading}
            onPress={() => {
              if (solo.status.playing) solo.toggle();
              live.tune(live.station === station ? null : station);
            }} />
          <Action label="Open OBS embed" href={`/embed/radio?station=${station.slug}&autoplay=1`} />
        </View>
      </View>
    </View>
  </Page>;
}
