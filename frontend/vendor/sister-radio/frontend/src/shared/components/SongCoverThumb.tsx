import { Show } from 'solid-js'
import { songCoverThumbnailUrl } from '../lib/radio'

export function SongCoverThumb(props: { coverUrl?: string; songId: string; hasCover: boolean; baseUrl?: string | null }) {
  return (
    <span class="song-cover-thumb" aria-hidden="true">
      <Show when={props.hasCover} fallback={<span class="song-cover-fallback">art</span>}>
        <img src={props.coverUrl ?? songCoverThumbnailUrl(props.songId, props.baseUrl)} alt="" loading="lazy" />
      </Show>
    </span>
  )
}
