import type { Track } from "plyr-shared/contract";
import { useEffect, useEffectEvent, useRef, type RefObject } from "react";
import { PlaybackNotificationManager, type AudioTagHandle } from "react-native-audio-api";
import { nowPlayingInfo } from "./nowPlayingInfo";
import type { Controls, Progress } from "./PlayerProvider";

type Args = { controls: Controls; progress: Progress; seeks: number; audio: RefObject<AudioTagHandle | null> };

/** Lock screen, Control Center and headphone controls for whatever is playing. */
export function useNowPlaying({ controls, progress, seeks, audio }: Args) {
  const { track, status, canNext } = controls;
  const playing = status === "playing" || status === "buffering";

  const onPlay = useEffectEvent(() => audio.current?.play());
  const onPause = useEffectEvent(() => audio.current?.pause());
  const onNext = useEffectEvent(() => controls.next());
  const onPrevious = useEffectEvent(() => controls.previous());
  const onSeek = useEffectEvent((seconds: number) => controls.seek(seconds));

  useEffect(() => {
    const subscriptions = [
      PlaybackNotificationManager.addEventListener("playbackNotificationPlay", () => onPlay()),
      PlaybackNotificationManager.addEventListener("playbackNotificationPause", () => onPause()),
      PlaybackNotificationManager.addEventListener("playbackNotificationNextTrack", () => onNext()),
      PlaybackNotificationManager.addEventListener("playbackNotificationPreviousTrack", () => onPrevious()),
      PlaybackNotificationManager.addEventListener("playbackNotificationSeekTo", ({ value }) => onSeek(value)),
    ];
    return () => subscriptions.forEach((s) => s.remove());
  }, []);

  useEffect(() => {
    void PlaybackNotificationManager.enableControl("nextTrack", canNext);
  }, [canNext]);

  // iOS extrapolates the scrubber from elapsed time and speed, so this follows state changes and seeks, not every tick
  const publish = useEffectEvent((current: Track) => PlaybackNotificationManager.show(nowPlayingInfo(current, { status, ...progress })));

  // hide() rejects when the native side has never registered a notification, which is every launch
  const shown = useRef(false);
  // a queue restored at launch is not announced until it is played, so opening the app never takes over the lock screen
  const begun = useRef(false);

  useEffect(() => {
    if (playing) begun.current = true;
    if (!track || !begun.current) {
      if (shown.current) void PlaybackNotificationManager.hide();
      shown.current = false;
      return;
    }
    shown.current = true;
    void PlaybackNotificationManager.enableControl("previousTrack", true);
    void PlaybackNotificationManager.enableControl("seekTo", true);
    void publish(track);
  }, [track, status, playing, progress.duration, seeks]);
}
