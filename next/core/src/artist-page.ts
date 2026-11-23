import { sellingLink, storeName } from './selling.ts';

// what an artist sets on their own page: links (like profile links on Bluesky)
// and what sits behind it. kept in plyr.fm settings for now, not a record, so
// the shape can still change.

export interface ProfileLink { url: string; label?: string }
export type Backdrop =
  | { kind: 'photo' }
  | { kind: 'plain' }
  | { kind: 'color'; color: string }
  | { kind: 'image'; image: string };
export interface ArtistPageSettings { links: ProfileLink[]; backdrop: Backdrop }

export const MAX_LINKS = 6;
export const MAX_LABEL = 64;
export const BACKDROP_COLORS = ['#e8743b', '#e2b53e', '#3f9a6b', '#3d7be0', '#8b5cf6', '#e0568d'] as const;

/** images plyr.fm already hosts (covers): a backdrop never points at another site */
const IMAGE_HOSTS = ['https://plyr-next-audio.n8-3e9.workers.dev/images/', 'https://images.plyr.fm/', 'https://images-stg.plyr.fm/'];
const COLOR = /^#[0-9a-f]{6}$/i;

export function backdropImage(url: unknown): string | undefined {
  const link = sellingLink(url);
  return link && IMAGE_HOSTS.some(host => link.startsWith(host)) ? link : undefined;
}

export function profileLink(value: unknown): ProfileLink | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const item = value as Record<string, unknown>;
  const url = sellingLink(item.url);
  if (!url) return undefined;
  const label = typeof item.label === 'string' ? item.label.trim() : '';
  // the backend counts bytes; keep a label well inside that
  if (label && (new TextEncoder().encode(label).length > MAX_LABEL || /[\u0000-\u001f\u007f]/.test(label))) return undefined;
  return label ? { url, label } : { url };
}

export function readBackdrop(value: unknown): Backdrop {
  if (!value || typeof value !== 'object') return { kind: 'photo' };
  const item = value as Record<string, unknown>;
  if (item.kind === 'plain') return { kind: 'plain' };
  if (item.kind === 'color' && typeof item.color === 'string' && COLOR.test(item.color)) return { kind: 'color', color: item.color.toLowerCase() };
  const image = item.kind === 'image' ? backdropImage(item.image) : undefined;
  if (image) return { kind: 'image', image };
  return { kind: 'photo' };
}

export function readLinks(value: unknown): ProfileLink[] {
  if (!Array.isArray(value)) return [];
  return value.map(profileLink).filter((link): link is ProfileLink => !!link).slice(0, MAX_LINKS);
}

/** the artist-page part of an account's settings */
export function readArtistPage(settings: unknown): ArtistPageSettings {
  const value = settings && typeof settings === 'object' ? settings as Record<string, unknown> : {};
  return { links: readLinks(value.profileLinks), backdrop: readBackdrop(value.backdrop) };
}

/** what a link reads as: the artist's label, else "Bandcamp" or the bare host */
export function linkName(link: ProfileLink): string {
  return link.label || storeName(link.url);
}

export function sameBackdrop(a: Backdrop, b: Backdrop): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function sameLinks(a: ProfileLink[], b: ProfileLink[]): boolean {
  return a.length === b.length && a.every((link, i) => link.url === b[i].url && (link.label ?? '') === (b[i].label ?? ''));
}
