import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useMediaSession } from './media-session';
import { PlaybackOverride, usePlayback } from './playback';
import { useAppPreferences } from './preference-context';
import { radioPosition, type RadioSnapshot, type RadioSong, type RadioStation } from './radio';
import { usePlayerAccounting } from './use-player-accounting';
import { useRadioFeed } from './use-radio-feed';

interface Radio {
  station: RadioStation | null;
  snapshot: RadioSnapshot | undefined;
  song: RadioSong | null;
  feedError: string;
  listening: boolean;
  status: ReturnType<typeof useAudioPlayerStatus>;
  /** Tunes in and starts listening, pausing whatever else was playing on this device. */
  tune(station: RadioStation): void;
  /** Leaves the radio, so the player goes back to the queue. */
  stop(): void;
  setListening(listening: boolean): void;
}

const RadioContext = createContext<Radio | null>(null);

export function useRadio(): Radio {
  const radio = useContext(RadioContext);
  if (!radio) throw new Error('radio provider is missing');
  return radio;
}

/** The one radio output. It sits under PlaybackProvider and gives way as soon as the queue starts something. */
export function RadioProvider({ children }: { children: ReactNode }) {
  const [station, setStation] = useState<RadioStation | null>(null);
  const [listening, setListening] = useState(false);
  const { snapshot, error: feedError } = useRadioFeed(station);
  const audio = useAudioPlayer(null);
  const status = useAudioPlayerStatus(audio);
  const accounting = usePlayerAccounting(audio);
  const solo = usePlayback();
  const { preferences } = useAppPreferences();
  const volume = useRef(preferences.volume);
  volume.current = preferences.volume;
  const latest = useRef(snapshot);
  latest.current = snapshot;
  const song = station ? snapshot?.currentSong ?? null : null;
  const source = song?.audio ?? null;

  useEffect(() => { audio.volume = preferences.volume; }, [audio, preferences.volume]);

  useEffect(() => {
    accounting.stop();
    audio.pause();
    audio.replace(source);
    audio.volume = volume.current;
  }, [accounting, audio, source]);

  useEffect(() => {
    if (!listening || !song) return;
    accounting.begin(song.id, song.durationSeconds);
    return () => accounting.stop();
  }, [accounting, listening, song]);

  useEffect(() => { if (status.error) setListening(false); }, [status.error]);

  const before = useRef({ playing: solo.status.playing, loading: solo.loading });
  useEffect(() => {
    const started = solo.status.playing && !before.current.playing || solo.loading && !before.current.loading;
    before.current = { playing: solo.status.playing, loading: solo.loading };
    if (started) { setListening(false); setStation(null); }
  }, [solo.status.playing, solo.loading]);

  useEffect(() => {
    if (!listening || !source) { audio.pause(); return; }
    if (!status.isLoaded) { audio.play(); return; }
    const live = latest.current;
    if (live && Math.abs(audio.currentTime - radioPosition(live)) > 2) void accounting.seekTo(radioPosition(live));
    if (!audio.playing) audio.play();
  }, [accounting, audio, listening, source, status.isLoaded]);

  useMediaSession('radio', station && song ? {
    title: song.title, artist: song.artist, album: `${station.label} radio`, artwork: song.artwork,
    playing: listening && status.playing,
    play: () => setListening(true),
    pause: () => setListening(false),
  } : null);

  const value = useMemo<Radio>(() => ({
    station, snapshot, song, feedError, listening, status,
    tune: next => {
      if (solo.jam) solo.leaveJam(false); else solo.pauseLocal();
      setStation(next);
      setListening(true);
    },
    stop: () => { setListening(false); setStation(null); },
    setListening,
  }), [station, snapshot, song, feedError, listening, status, solo]);
  return <RadioContext.Provider value={value}>{children}</RadioContext.Provider>;
}

/**
 * While a station is tuned, the player surfaces below see it as the current track: same dock, same now playing,
 * with `live` set so they drop seeking, skipping and the queue.
 */
export function RadioPlayback({ children }: { children: ReactNode }) {
  const radio = useRadio();
  const solo = usePlayback();
  const [, tick] = useState(0);
  const tuned = !!radio.station;
  useEffect(() => {
    if (!tuned) return;
    const timer = setInterval(() => tick(n => n + 1), 1000);
    return () => clearInterval(timer);
  }, [tuned]);
  const { station, song, snapshot, status, listening } = radio;
  // Always the same element, so tuning in or out never remounts the dock or now playing below it.
  if (!station || !song || !snapshot) return <PlaybackOverride value={solo}>{children}</PlaybackOverride>;
  const position = radioPosition(snapshot);
  return <PlaybackOverride value={{
    ...solo,
    live: { station },
    current: song.track, queue: [song.track], index: 0, tail: undefined, jam: undefined,
    canSeek: false, seekPreview: undefined, privatePlayback: false, outputElsewhere: false, deviceQueue: false, queueError: undefined,
    loading: listening && !status.playing && !status.error,
    error: status.error ? 'couldn’t play this station' : null,
    status: { ...status, playing: listening && status.playing, currentTime: position, duration: song.durationSeconds, didJustFinish: false },
    repeat: 'off', keepPlaying: false,
    setPlaying: radio.setListening,
    toggle: () => radio.setListening(!listening),
    isPlaying: () => listening,
    pauseLocal: () => radio.setListening(false),
    next: async () => {}, previous: () => {}, seek: () => {}, skip: () => {}, jump: () => {},
  }}>{children}</PlaybackOverride>;
}
