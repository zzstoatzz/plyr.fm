import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import type { Page } from '../../core/src/api';
import { catalogRevision, type CatalogScope } from '../../core/src/catalog/changes';
import { createCatalogPages } from '../../core/src/catalog/pages';

export function usePortalPages<T>(did: string, scope: CatalogScope, load: (cursor?: string) => Promise<Page<T>>, active: boolean) {
  const pages = useMemo(() => createCatalogPages(load, () => catalogRevision(did, scope)), [did, scope, load]);
  const view = useSyncExternalStore(pages.subscribe, pages.snapshot, pages.snapshot);
  useEffect(() => {
    pages.connect();
    void pages.refresh();
    return pages.disconnect;
  }, [pages]);
  useFocusEffect(useCallback(() => {
    pages.activate(active);
    return () => pages.activate(false);
  }, [active, pages]));

  return { ...view, more: pages.more, reload: pages.refresh, retry: pages.retry };
}
