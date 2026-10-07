import type { Track } from "plyr-shared/contract";
import { IMAGE_WIDTHS, resizedImageUrl, trackCoverUrl } from "plyr-shared/images";
import { useEffect, useEffectEvent, type RefObject } from "react";
import { PlaybackNotificationManager, type AudioTagHandle } from "react-native-audio-api";
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
  const publish = useEffectEvent((current: Track) =>
    PlaybackNotificationManager.show({
      title: current.title,
      artist: current.artist,
      album: current.album?.title,
      artwork: resizedImageUrl(trackCoverUrl(current), IMAGE_WIDTHS.hero) ?? undefined,
      duration: progress.duration || undefined,
      elapsedTime: progress.position,
      speed: playing ? 1 : 0,
      state: playing ? "playing" : "paused",
    }),
  );

  useEffect(() => {
    if (!track) {
      void PlaybackNotificationManager.hide();
      return;
    }
    void PlaybackNotificationManager.enableControl("previousTrack", true);
    void PlaybackNotificationManager.enableControl("seekTo", true);
    void publish(track);
  }, [track, playing, progress.duration, seeks]);
}
