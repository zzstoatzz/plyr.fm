import { api } from './api';
import { PlayOutbox } from './play-outbox';
import { playOutboxStorage } from './play-outbox-storage';
import { playMetrics } from './play-metrics';
import { radioTrackId } from './radio-track';

let outbox: PlayOutbox | undefined;

export function playOutbox() {
  if (!outbox) {
    outbox = new PlayOutbox({
      storage: playOutboxStorage,
      resolve: async (play) => play.trackId.startsWith('radio:') ? {
        ...play,
        trackId: await radioTrackId(play.trackId.slice(6), new AbortController().signal),
      } : play,
      send: api.recordPlay,
      onReceipt: (receipt) => {
        playMetrics.observe(receipt.track_id, receipt.play_count);
        console.info('[plays] receipt', { occurrence: receipt.occurrence, track: receipt.track_id,
          counted: receipt.counted, status: receipt.dedup.status, count: receipt.play_count });
      },
    });
  }
  return outbox;
}
