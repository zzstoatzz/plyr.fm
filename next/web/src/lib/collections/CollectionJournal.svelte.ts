import type { CreateOperation } from '@plyr/next-core/publishing/create-operation';
import type { createPds } from '$lib/pds';

export function collectionJournal(pds: ReturnType<typeof createPds>, current: () => boolean) {
  const view = $state({ operations: [] as CreateOperation[], loading: true, error: '' });
  let version = 0;

  async function refresh() {
    const attempt = ++version;
    try {
      const operations = await pds.pendingCreates('playlist');
      if (!current() || attempt !== version) return;
      view.operations = operations;
      view.error = '';
    } catch {
      if (current() && attempt === version) view.error = 'could not load creation recovery. try again before publishing.';
    } finally {
      if (current() && attempt === version) view.loading = false;
    }
  }

  return { view, refresh };
}
