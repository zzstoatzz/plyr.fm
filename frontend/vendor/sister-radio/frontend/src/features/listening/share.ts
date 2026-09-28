import { ok } from '@atcute/client'
import { listenerRepoClient } from '../../shared/lib/radioXrpc'

export interface ShareTrack {
  title: string
  artist: string
  stationName: string
  /** The station's public URL; the post's link card points here. */
  stationUrl: string
  /** Cover art URL, if the song has one. */
  coverUrl?: string | null
  /** The cover's accent colour as "r g b", used to tint the share card. */
  accentRgb?: string | null
}

// Bluesky's post text limit, in graphemes; a code-point count is a safe
// stand-in since it never undercounts graphemes.
const MAX_POST_LENGTH = 300
// app.bsky.embed.external thumbs are capped at 1MB; Bluesky shows link cards
// at roughly 1.91:1, the usual Open Graph shape.
const MAX_THUMB_BYTES = 1_000_000
const CARD_WIDTH = 1200
const CARD_HEIGHT = 630
const CARD_FONT = '"AnalogMonoPlus", ui-monospace, "Hiragino Sans", "Noto Sans CJK JP", sans-serif'

function defaultShareLine(track: ShareTrack): string {
  return `📻 listening to ${track.title} — ${track.artist} on ${track.stationName}`
}

function clipText(text: string): string {
  const chars = [...text]
  return chars.length <= MAX_POST_LENGTH ? text : `${chars.slice(0, MAX_POST_LENGTH - 1).join('')}…`
}

/**
 * Link to Bluesky's composer prefilled with the track, so anyone can share
 * and edit the post first, signed in here or not.
 */
export function composeShareUrl(track: ShareTrack): string {
  const text = clipText(`${defaultShareLine(track)}\n${track.stationUrl}`)
  return `https://bsky.app/intent/compose?text=${encodeURIComponent(text)}`
}

async function loadCover(coverUrl: string): Promise<ImageBitmap | null> {
  try {
    const response = await fetch(coverUrl)
    return response.ok ? await createImageBitmap(await response.blob()) : null
  } catch {
    return null
  }
}

/** Draws text on one line, trimming it with an ellipsis to fit `maxWidth`. */
function fitText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number): void {
  let value = text
  while (value.length > 1 && ctx.measureText(value).width > maxWidth) {
    value = [...value].slice(0, -2).join('') + '…'
  }
  ctx.fillText(value, x, y)
}

/**
 * Renders the link-card image for a share: the cover beside the title,
 * artist, and station, on a wash of the cover's colour, in the same style as
 * the /embed player.
 */
export async function shareCardImage(track: ShareTrack): Promise<Blob | null> {
  const canvas = document.createElement('canvas')
  canvas.width = CARD_WIDTH
  canvas.height = CARD_HEIGHT
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  await document.fonts.load(`700 64px ${CARD_FONT}`).catch(() => undefined)

  const accent = track.accentRgb?.split(' ').map(Number)
  const [r, g, b] = accent?.length === 3 && accent.every(Number.isFinite) ? accent : [190, 124, 143]
  const background = ctx.createLinearGradient(0, 0, CARD_WIDTH, CARD_HEIGHT)
  background.addColorStop(0, `rgb(${Math.round(r * 0.35 + 30 * 0.65)} ${Math.round(g * 0.35 + 30 * 0.65)} ${Math.round(b * 0.35 + 30 * 0.65)})`)
  background.addColorStop(1, '#1e1e1e')
  ctx.fillStyle = background
  ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT)

  const pad = 60
  const coverSize = CARD_HEIGHT - pad * 2
  const cover = track.coverUrl ? await loadCover(track.coverUrl) : null
  ctx.save()
  ctx.beginPath()
  ctx.roundRect(pad, pad, coverSize, coverSize, 16)
  ctx.clip()
  if (cover) {
    // Centre-crop non-square covers.
    const side = Math.min(cover.width, cover.height)
    ctx.drawImage(cover, (cover.width - side) / 2, (cover.height - side) / 2, side, side, pad, pad, coverSize, coverSize)
    cover.close()
  } else {
    ctx.fillStyle = `rgb(${r} ${g} ${b} / 25%)`
    ctx.fillRect(pad, pad, coverSize, coverSize)
  }
  ctx.restore()
  ctx.strokeStyle = `rgb(${r} ${g} ${b} / 45%)`
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.roundRect(pad, pad, coverSize, coverSize, 16)
  ctx.stroke()

  const textX = pad + coverSize + 56
  const textWidth = CARD_WIDTH - textX - pad
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = `rgb(${r} ${g} ${b})`
  ctx.font = `400 30px ${CARD_FONT}`
  // The station is named once, in the footer; this line matches the page's eyebrow.
  fitText(ctx, 'now playing', textX, 200, textWidth)
  ctx.fillStyle = '#f4eeee'
  ctx.font = `700 64px ${CARD_FONT}`
  fitText(ctx, track.title, textX, 290, textWidth)
  ctx.fillStyle = '#b7aaaa'
  ctx.font = `400 38px ${CARD_FONT}`
  fitText(ctx, track.artist, textX, 350, textWidth)

  ctx.fillStyle = 'rgb(255 255 255 / 12%)'
  ctx.fillRect(textX, 400, textWidth, 6)
  ctx.fillStyle = '#b7aaaa'
  ctx.font = `400 28px ${CARD_FONT}`
  fitText(ctx, `📻 ${new URL(track.stationUrl).host}`, textX, CARD_HEIGHT - pad - 12, textWidth)

  for (const quality of [0.88, 0.75, 0.6]) {
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality))
    if (blob && blob.size <= MAX_THUMB_BYTES) return blob
  }
  return null
}

/**
 * Posts the track to the listener's Bluesky with a link card to the station.
 * @param note Optional text to post instead of the default "listening to" line.
 * @throws Error when nobody is signed in or the PDS rejects the write.
 */
export async function postShare(track: ShareTrack, note?: string): Promise<void> {
  const repo = await listenerRepoClient()
  if (!repo) throw new Error('sign in to share')

  let thumb: unknown
  {
    // A missing thumbnail shouldn't stop the post.
    try {
      const image = await shareCardImage(track)
      if (image) {
        const response = await repo.agent.handle('/xrpc/com.atproto.repo.uploadBlob', {
          method: 'POST',
          headers: { 'Content-Type': image.type },
          body: image,
        })
        if (response.ok) thumb = ((await response.json()) as { blob: unknown }).blob
      }
    } catch (error) {
      console.warn('share thumbnail failed', error)
    }
  }

  const external: Record<string, unknown> = {
    uri: track.stationUrl,
    title: `${track.title} — ${track.artist}`,
    description: `on ${track.stationName}`,
  }
  if (thumb) external.thumb = thumb

  await ok(repo.client.post('com.atproto.repo.createRecord', {
    input: {
      repo: repo.did,
      collection: 'app.bsky.feed.post',
      record: {
        $type: 'app.bsky.feed.post',
        text: clipText(note?.trim() || defaultShareLine(track)),
        createdAt: new Date().toISOString(),
        embed: { $type: 'app.bsky.embed.external', external },
      },
    },
    as: 'json',
  }))
}
