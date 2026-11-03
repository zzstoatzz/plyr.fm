import Play from 'lucide-react-native/icons/play';
import Pause from 'lucide-react-native/icons/pause';
import { PlayerControl } from '../src/PlayerControl';
import { useAppearance } from '../src/appearance';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { Cover, Heading } from '../src/CatalogPieces';
import { Action, Copy, Page, row } from '../src/controls';
import { usePlayback } from '../src/playback';
import { useAppPreferences } from '../src/preference-context';
import { radioMedia, radioPosition, radioStations, readRadio, type RadioSnapshot } from '../src/radio';

export default function Radio({ compact = false }: { compact?: boolean }) {
  const { autoplay, station: stationSlug } = useLocalSearchParams<{ autoplay?: string; station?: string }>();
  const theme = useAppearance();
  const autoTuned = useRef(false);
  const [station, setStation] = useState<typeof radioStations[number]>(() => radioStations.find(item => item.slug === stationSlug) ?? radioStations[0]);
  const [snapshot, setSnapshot] = useState<RadioSnapshot>();
  const [listening, setListening] = useState(false);
  const [error, setError] = useState('');
  const audio = useAudioPlayer(null);
  const status = useAudioPlayerStatus(audio);
  const solo = usePlayback();
  const { preferences } = useAppPreferences();
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const song = snapshot?.currentSong;
  const source = song ? radioMedia(station, song, 'audio') : null;

  useFocusEffect(useCallback(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const next = await readRadio(station, controller.signal);
        if (!controller.signal.aborted) {
          setSnapshot(next);
          setError('');
        }
      } catch {
        if (!controller.signal.aborted) setError('Could not reach this station. Retrying…');
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(() => void poll(), 5000);
      }
    }
    void poll();
    return () => {
      controller.abort();
      clearTimeout(timer);
      audio.pause();
      setListening(false);
    };
  }, [audio, station]));

  useEffect(() => {
    audio.volume = preferences.volume;
  }, [audio, preferences.volume]);

  useEffect(() => {
    audio.pause();
    audio.replace(source);
  }, [audio, source]);

  useEffect(() => {
    if (autoplay !== '1' || autoTuned.current || !source || snapshot?.state.status !== 'playing') return;
    autoTuned.current = true;
    if (!solo.status.playing && !solo.loading) setListening(true);
  }, [autoplay, snapshot?.state.status, solo.loading, solo.status.playing, source]);

  useEffect(() => {
    if (status.error) setListening(false);
  }, [status.error]);

  useEffect(() => {
    if (solo.status.playing) setListening(false);
  }, [solo.status.playing]);

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
      if (Math.abs(audio.currentTime - target) > 2) void audio.seekTo(target);
    }
    if (!audio.playing) audio.play();
  }, [audio, listening, snapshot, source, status.isLoaded]);

  if (compact) return <View style={{ width: '100%', maxWidth: 360, padding: 8, gap: 6 }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, padding: 8, borderRadius: 12, backgroundColor: theme.background }}>
      <Cover size={48} uri={song?.hasCover ? radioMedia(station, song, 'cover') : null} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ color: theme.text, fontSize: 15, fontWeight: '700' }}>{song?.title ?? station.label}</Text>
        <Text numberOfLines={1} style={{ color: theme.muted, fontSize: 12 }}>
          {status.error ? 'Couldn’t play this station' : error || (song ? `${song.artist} · Radio` : snapshot ? 'Off air' : 'Loading station…')}
        </Text>
      </View>
      {song && <PlayerControl icon={listening ? Pause : Play} label={listening ? 'Stop listening' : 'Listen live'}
        onPress={() => setListening(!listening)} />}
    </View>
  </View>;

  return <Page title="Radio">
    <View style={row}>
      {radioStations.map(item => <Action key={item.slug} label={item.label} selected={item === station}
        onPress={() => {
          if (item === station) return;
          setSnapshot(undefined);
          setError('');
          setStation(item);
        }} />)}
    </View>
    {song && <View style={row}>
      <Cover size={72} uri={song.hasCover ? radioMedia(station, song, 'cover') : null} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Heading>{song.title}</Heading>
        <Copy>{song.artist}</Copy>
      </View>
    </View>}
    {error ? <Copy>{error}</Copy> : !snapshot ? <Copy>Loading station…</Copy> : !song && <Copy>This station is off air.</Copy>}
    {status.error && <Copy>Couldn’t play this station.</Copy>}
    <Action primary label={listening ? 'Stop listening' : 'Listen live'} disabled={!listening && !song}
      onPress={() => {
        if (!listening && solo.status.playing) solo.toggle();
        setListening(!listening);
      }} />
  </Page>;
}
