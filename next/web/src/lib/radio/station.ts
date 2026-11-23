import { createRadioFeeds } from '@plyr/next-core/radio-feed';
import { radioPosition, type RadioSnapshot, type RadioStation } from '@plyr/next-core/radio';
import { apiOrigin } from '$lib/api';
import { player } from '$lib/player.svelte';

export const feeds = createRadioFeeds(apiOrigin);

function onAir(snapshot: RadioSnapshot) {
  const song = snapshot.currentSong;
  if (!song || (snapshot.endsAt !== null && snapshot.endsAt <= Date.now())) {
    // the station's off-air check fails closed, so one slow answer from the broadcaster reads as off air; a stream
    // still playing outlasts that, and production keeps it too. a broadcast that really ends stops the element itself
    if (!song && player.airingBroadcast) return;
    player.clearRadioTrack();
    return;
  }
  const occurrence = JSON.stringify([song.id, song.audio, snapshot.endsAt]);
  void player.setRadioTrack(song.track, song.audio, occurrence, () => radioPosition(snapshot), song.live);
}

/** `listen` false tunes in paused, for a shared link that opens before anyone has tapped. */
export function tuneRadio(station: RadioStation, openNowPlaying?: () => void, listen = true) {
  if (player.liveStation === station) {
    if (listen && !player.liveListening) player.setRadioListening(true);
    if (player.current) openNowPlaying?.();
    return;
  }
  const feed = feeds.get(station.slug);
  if (!feed) return;
  let opening = openNowPlaying;
  let unsubscribe: (() => void) | undefined;
  player.startRadio(station, () => unsubscribe?.(), listen);
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
