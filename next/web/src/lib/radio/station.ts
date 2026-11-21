import { createRadioFeeds } from '@plyr/next-core/radio-feed';
import { radioPosition, type RadioSnapshot, type RadioStation } from '@plyr/next-core/radio';
import { player } from '$lib/player.svelte';

export const feeds = createRadioFeeds();

function onAir(snapshot: RadioSnapshot) {
  const song = snapshot.currentSong;
  if (!song || (snapshot.endsAt !== null && snapshot.endsAt <= Date.now())) { player.clearRadioTrack(); return; }
  const occurrence = JSON.stringify([song.id, song.audio, snapshot.endsAt]);
  void player.setRadioTrack(song.track, song.audio, occurrence, () => radioPosition(snapshot), song.live);
}

export function tuneRadio(station: RadioStation, openNowPlaying?: () => void) {
  if (player.liveStation === station) {
    if (!player.liveListening) player.setRadioListening(true);
    if (player.current) openNowPlaying?.();
    return;
  }
  const feed = feeds.get(station.slug);
  if (!feed) return;
  let opening = openNowPlaying;
  let unsubscribe: (() => void) | undefined;
  player.startRadio(station, () => unsubscribe?.());
  const changed = () => {
    const { snapshot, error } = feed.getSnapshot();
    if (error && !player.current) {
      player.loading = false;
      player.error = error;
    }
    if (!snapshot) return;
    onAir(snapshot);
    if (opening && player.current) {
      opening();
      opening = undefined;
    }
  };
  unsubscribe = feed.subscribe(changed);
  changed();
}
