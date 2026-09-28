// Whole-file prefetch for the next song. Streaming stalls whenever the
// connection drops (trains, driving); a song that is already fully in memory
// plays through regardless. Downloads resume where they stopped via Range
// requests, so a dead zone mid-download doesn't throw the progress away.

const MAX_ATTEMPTS = 8
const MAX_BACKOFF_MS = 30_000

interface PrefetchEntry {
  controller: AbortController
  objectUrl: string | null
}

export interface SongPrefetcher {
  /** Starts downloading `url` for `songId` unless it's already in hand or in flight. */
  prefetch: (songId: string, url: string) => void
  /** The in-memory copy of a fully downloaded song, if there is one. */
  objectUrlFor: (songId: string) => string | null
  /** Drops (aborts and frees) every song not listed. */
  retain: (songIds: Array<string | null | undefined>) => void
  dispose: () => void
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = window.setTimeout(resolve, ms)
    signal.addEventListener('abort', () => {
      window.clearTimeout(timer)
      resolve()
    }, { once: true })
  })
}

async function downloadWhole(url: string, signal: AbortSignal): Promise<Blob | null> {
  const chunks: Uint8Array<ArrayBuffer>[] = []
  let received = 0
  let contentType = ''
  let failures = 0

  while (!signal.aborted) {
    try {
      const response = await fetch(url, {
        signal,
        headers: received > 0 ? { Range: `bytes=${received}-` } : undefined,
      })
      if (received > 0 && response.status !== 206) {
        // The server ignored the range: start over from this full response.
        chunks.length = 0
        received = 0
      }
      if (!response.ok || !response.body) throw new Error(`audio fetch ${response.status}`)
      contentType ||= response.headers.get('content-type') ?? ''

      const reader = response.body.getReader()
      for (;;) {
        const { done, value } = await reader.read()
        if (done) return new Blob(chunks, { type: contentType })
        chunks.push(value)
        received += value.byteLength
        failures = 0
      }
    } catch (error) {
      if (signal.aborted) return null
      failures += 1
      if (failures >= MAX_ATTEMPTS) {
        console.warn('song prefetch gave up', url, error)
        return null
      }
      await sleep(Math.min(MAX_BACKOFF_MS, 1000 * 2 ** failures), signal)
    }
  }
  return null
}

export function createSongPrefetcher(): SongPrefetcher {
  const entries = new Map<string, PrefetchEntry>()

  const drop = (songId: string) => {
    const entry = entries.get(songId)
    if (!entry) return
    entry.controller.abort()
    if (entry.objectUrl) URL.revokeObjectURL(entry.objectUrl)
    entries.delete(songId)
  }

  return {
    prefetch(songId, url) {
      if (entries.has(songId)) return
      const entry: PrefetchEntry = { controller: new AbortController(), objectUrl: null }
      entries.set(songId, entry)
      void downloadWhole(url, entry.controller.signal).then((blob) => {
        if (!blob || entry.controller.signal.aborted) {
          // Failed: forget it so a later call can try again.
          if (entries.get(songId) === entry && !entry.objectUrl) entries.delete(songId)
          return
        }
        entry.objectUrl = URL.createObjectURL(blob)
      })
    },
    objectUrlFor(songId) {
      return entries.get(songId)?.objectUrl ?? null
    },
    retain(songIds) {
      const keep = new Set(songIds.filter((id): id is string => Boolean(id)))
      for (const songId of [...entries.keys()]) {
        if (!keep.has(songId)) drop(songId)
      }
    },
    dispose() {
      for (const songId of [...entries.keys()]) drop(songId)
    },
  }
}
