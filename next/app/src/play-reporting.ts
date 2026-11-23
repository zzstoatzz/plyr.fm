import { api } from './api-client';
import { PlayOutbox } from '@plyr/next-core/play-outbox';
import { playOutboxStorage } from './play-outbox-storage';
import { playMetrics } from '@plyr/next-core/play-metrics';

let outbox: PlayOutbox | undefined;

export function playOutbox() {
  if (!outbox) {
    outbox = new PlayOutbox({
      storage: playOutboxStorage,
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
