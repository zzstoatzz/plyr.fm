import { ChevronLeft, ChevronRight } from 'lucide-solid'

interface PaginationRowProps {
  page: number
  pageCount: number
  onPageChange: (page: number) => void
  compact?: boolean
}

export function PaginationRow(props: PaginationRowProps) {
  return (
    <div class={`pagination-row${props.compact ? ' compact' : ''}`}>
      <button
        class="pill-button subtle"
        type="button"
        disabled={props.page === 0}
        onClick={() => props.onPageChange(Math.max(0, props.page - 1))}
        aria-label="previous page"
      >
        <ChevronLeft size={18} />
      </button>
      <span>{props.page + 1} / {props.pageCount}</span>
      <button
        class="pill-button subtle"
        type="button"
        disabled={props.page >= props.pageCount - 1}
        onClick={() => props.onPageChange(Math.min(props.pageCount - 1, props.page + 1))}
        aria-label="next page"
      >
        <ChevronRight size={18} />
      </button>
    </div>
  )
}
