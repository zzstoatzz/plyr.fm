import { createEffect, createMemo, createSignal, type Accessor } from 'solid-js'

export interface PagedList<T> {
  page: Accessor<number>
  setPage: (page: number) => void
  pageCount: Accessor<number>
  paged: Accessor<T[]>
}

/**
 * Returns a paginated view over a reactive list, auto-clamping the current
 * page when the source shrinks.
 */
export function createPagedList<T>(source: Accessor<T[]>, pageSize: number): PagedList<T> {
  const [page, setPage] = createSignal(0)
  const pageCount = createMemo(() => Math.max(1, Math.ceil(source().length / pageSize)))
  const paged = createMemo(() => {
    const start = page() * pageSize
    return source().slice(start, start + pageSize)
  })

  createEffect(() => {
    if (page() >= pageCount()) {
      setPage(pageCount() - 1)
    }
  })

  return { page, setPage, pageCount, paged }
}
