import type { Artist } from './api.ts';
import { formatPrice } from './access/policy.ts';

// "sell your music" for now: the artist points listeners at wherever they
// already sell. plyr never sees the payment, so an offer is a link to open,
// never an entitlement. a provider plyr can verify (Atmosphere Money) becomes
// another `provider` here and in the access decider, not a new shape.

export type Provider = 'link';

export interface Offer {
  provider: Provider;
  /** at-uri of the release or track this sells */
  subject: string;
  url: string;
  /** smallest currency unit, display only */
  amount?: number;
  currency?: string;
}

export interface StoredOffer { subject: string; url: string; amount?: number; currency?: string }
export interface SellingSettings { supportUrl: string; buyLinks: StoredOffer[] }

const MAX_LINK = 512;
export const MAX_OFFERS = 200;

/** an https link a listener can open: what the backend also accepts */
export function sellingLink(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  if (text.length > MAX_LINK || !/^https:\/\//i.test(text) || /[\s\u0000-\u001f\u007f-￿]/.test(text)) return undefined;
  try {
    const url = new URL(text);
    if (url.protocol !== 'https:' || url.username || url.password || !url.hostname.includes('.')) return undefined;
    return text;
  } catch { return undefined; }
}

/** a pasted link, forgiving a missing https:// */
export function normalizeLink(text: string): string | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  return sellingLink(/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
}

const STORES: [RegExp, string][] = [
  [/(^|\.)bandcamp\.com$/, 'Bandcamp'],
  [/(^|\.)ko-fi\.com$/, 'ko-fi'],
  [/(^|\.)patreon\.com$/, 'Patreon'],
  [/(^|\.)buymeacoffee\.com$/, 'Buy Me a Coffee'],
  [/(^|\.)liberapay\.com$/, 'Liberapay'],
  [/(^|\.)gumroad\.com$/, 'Gumroad'],
  [/(^|\.)itch\.io$/, 'itch.io'],
  [/(^|\.)paypal\.(com|me)$/, 'PayPal'],
  [/^github\.com$/, 'GitHub Sponsors'],
  [/(^|\.)subvert\.fm$/, 'Subvert'],
  [/(^|\.)mirlo\.space$/, 'Mirlo'],
  [/(^|\.)atprotofans\.com$/, 'atprotofans'],
];

/** "Bandcamp" for a bandcamp link, otherwise the bare host */
export function storeName(url: string): string {
  let host = '';
  try { host = new URL(url).hostname.toLowerCase().replace(/^www\./, ''); } catch { return 'the web'; }
  return STORES.find(([pattern]) => pattern.test(host))?.[1] ?? host;
}

/** "$8 on Bandcamp", or "on Bandcamp" without a price */
export function offerLabel(offer: Pick<Offer, 'url' | 'amount' | 'currency'>): string {
  const where = `on ${storeName(offer.url)}`;
  return offer.amount !== undefined && offer.currency ? `${formatPrice(offer.amount, offer.currency)} ${where}` : where;
}

const CURRENCY = /^[A-Z]{3}$/;

function stored(value: unknown): StoredOffer | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const item = value as Record<string, unknown>;
  const url = sellingLink(item.url);
  if (typeof item.subject !== 'string' || !item.subject.startsWith('at://') || !url) return undefined;
  const priced = Number.isSafeInteger(item.amount) && (item.amount as number) >= 0 && typeof item.currency === 'string' && CURRENCY.test(item.currency);
  return { subject: item.subject, url, ...(priced ? { amount: item.amount as number, currency: item.currency as string } : {}) };
}

/** the artist's public offers, from the artist read */
export function artistOffers(artist: Pick<Artist, 'offers'> | undefined): Offer[] {
  const list = Array.isArray(artist?.offers) ? artist.offers : [];
  return list.flatMap(item => { const offer = stored(item); return offer ? [{ provider: 'link' as const, ...offer }] : []; });
}

/** the first offer for any of these subjects, in the order given */
export function offerFor(artist: Pick<Artist, 'offers'> | undefined, subjects: (string | undefined | null)[]): Offer | undefined {
  const offers = artistOffers(artist);
  for (const subject of subjects) {
    const found = subject && offers.find(offer => offer.subject === subject);
    if (found) return found;
  }
  return undefined;
}

export function supportLink(artist: Pick<Artist, 'support_url'> | undefined): string | undefined {
  return sellingLink(artist?.support_url ?? undefined);
}

/** the selling part of the account's settings */
export function readSelling(preferences: unknown): SellingSettings {
  const value = preferences && typeof preferences === 'object' ? preferences as Record<string, unknown> : {};
  const buyLinks = Array.isArray(value.buyLinks) ? value.buyLinks.flatMap(item => { const offer = stored(item); return offer ? [offer] : []; }) : [];
  return { supportUrl: sellingLink(value.supportUrl) ?? '', buyLinks };
}

/** one release's buy link set, replaced, or removed when url is empty */
export function withBuyLink(links: StoredOffer[], next: StoredOffer | { subject: string; url?: undefined }): StoredOffer[] {
  const rest = links.filter(link => link.subject !== next.subject);
  return next.url ? [...rest, next as StoredOffer].slice(0, MAX_OFFERS) : rest;
}
