import { formatPrice, parsePrice, priceText, type Rule } from '../access/policy.ts';
import { normalizeLink } from '../selling.ts';
import type { BuyLink, DownloadPolicy } from '../pds.ts';

// who can listen to a track being uploaded: open to everyone, or closed with
// any number of ways in. closed with none is "only you", which stays in the
// artist's private library; closed with some keeps the record public and the
// audio in a space those ways open.

export const UPLOAD_CURRENCY = 'USD';
export type WayDraft =
  | { kind: 'supporter' }
  | { kind: 'signedIn' }
  | { kind: 'purchase'; price: string }
  | { kind: 'members'; people: string };
export type WayKind = WayDraft['kind'];
export interface AccessDraft { closed: boolean; ways: WayDraft[] }

export const OPEN: AccessDraft = { closed: false, ways: [] };
/** the order ways are offered and listed in */
export const WAY_KINDS: readonly WayKind[] = ['supporter', 'purchase', 'signedIn', 'members'];

export function newWay(kind: WayKind): WayDraft {
  return kind === 'purchase' ? { kind, price: '' } : kind === 'members' ? { kind, people: '' } : { kind };
}

/** a way with that kind added in its place, or the list unchanged when it's already there */
export function addWay(ways: readonly WayDraft[], kind: WayKind): WayDraft[] {
  if (ways.some(way => way.kind === kind)) return [...ways];
  return [...ways, newWay(kind)].sort((a, b) => WAY_KINDS.indexOf(a.kind) - WAY_KINDS.indexOf(b.kind));
}

export function people(text: string): string[] {
  return [...new Set(text.split(/[\s,]+/).map(name => name.replace(/^@/, '')).filter(Boolean))];
}

/** what's wrong with a way as typed, said at the field */
export function wayProblem(way: WayDraft, currency = UPLOAD_CURRENCY): string | undefined {
  if (way.kind === 'purchase' && !parsePrice(way.price, currency)) return 'enter a price, like 5 or 4.99.';
  if (way.kind === 'members' && !people(way.people).length) return 'add at least one handle, like name.bsky.social.';
  return undefined;
}

export function accessProblem(access: AccessDraft, currency = UPLOAD_CURRENCY): string | undefined {
  if (!access.closed) return undefined;
  for (const way of access.ways) { const problem = wayProblem(way, currency); if (problem) return problem; }
  return undefined;
}

/** an only-you upload goes to the private library, not to a space */
export const onlyYou = (access: AccessDraft) => access.closed && !access.ways.length;

/** the rules a closed upload writes; handles become dids through `resolve` */
export async function accessRules(access: AccessDraft, resolve: (handle: string) => Promise<string>, currency = UPLOAD_CURRENCY): Promise<Rule[]> {
  if (!access.closed) return [];
  const problem = accessProblem(access, currency);
  if (problem) throw new Error(problem);
  const rules: Rule[] = [];
  for (const way of access.ways) {
    if (way.kind === 'purchase') rules.push({ kind: 'purchase', amount: parsePrice(way.price, currency)!, currency });
    else if (way.kind === 'members') rules.push({ kind: 'members', members: [...new Set(await Promise.all(people(way.people).map(resolve)))] });
    else rules.push({ kind: way.kind });
  }
  return rules;
}

/** rules as far as they can be known before handles resolve, for the listener preview */
export function previewRules(access: AccessDraft, currency = UPLOAD_CURRENCY): { rule: Rule }[] {
  return access.ways.flatMap((way): { rule: Rule }[] => {
    if (way.kind === 'purchase') { const amount = parsePrice(way.price, currency); return amount ? [{ rule: { kind: 'purchase' as const, amount, currency } }] : []; }
    if (way.kind === 'members') return [{ rule: { kind: 'members' as const, members: people(way.people) } }];
    return [{ rule: { kind: way.kind } }];
  });
}

/** the floating bar's line: "open to everyone", "only you", "closed · supporters · $5 to buy" */
export function accessSummary(access: AccessDraft, currency = UPLOAD_CURRENCY): { label: string; detail?: string } {
  if (!access.closed) return { label: 'open to everyone' };
  if (!access.ways.length) return { label: 'only you' };
  const parts = access.ways.map(way => {
    if (way.kind === 'supporter') return 'supporters';
    if (way.kind === 'signedIn') return 'anyone signed in';
    if (way.kind === 'members') { const count = people(way.people).length; return count === 1 ? '1 person' : `${count} people`; }
    const amount = parsePrice(way.price, currency);
    return amount ? `${formatPrice(amount, currency).replace(/[.,]00(?=\D*$)/, '')} to buy` : 'buyers';
  });
  return { label: 'closed', detail: parts.join(' · ') };
}

/** a saved draft's access; one that can't be read comes back as only you, never open and never with a way the artist didn't pick */
export function readAccessDraft(value: unknown): AccessDraft {
  const unreadable: AccessDraft = { closed: true, ways: [] };
  if (!value || typeof value !== 'object') return unreadable;
  const { closed, ways } = value as Record<string, unknown>;
  if (typeof closed !== 'boolean' || !Array.isArray(ways)) return unreadable;
  const read: WayDraft[] = [];
  for (const way of ways) {
    if (!way || typeof way !== 'object') continue;
    const { kind, price, people: names } = way as Record<string, unknown>;
    if (kind === 'supporter' || kind === 'signedIn') read.push({ kind });
    else if (kind === 'purchase' && typeof price === 'string') read.push({ kind, price });
    else if (kind === 'members' && typeof names === 'string') read.push({ kind, people: names });
  }
  return { closed, ways: closed ? read : [] };
}

/** a queued upload's rules back in the form, when it's reopened to edit */
export function accessFromRules(rules: readonly Rule[] | undefined, currency = UPLOAD_CURRENCY): AccessDraft {
  if (!rules?.length) return { ...OPEN };
  const ways: WayDraft[] = [];
  for (const rule of rules) {
    if (rule.kind === 'purchase') ways.push({ kind: 'purchase', price: rule.currency === currency ? priceText(rule.amount, currency) : '' });
    else if (rule.kind === 'members') ways.push({ kind: 'members', people: rule.members.join(' ') });
    else ways.push({ kind: rule.kind });
  }
  return { closed: true, ways };
}

/** who can download, as the upload form offers it */
export const DOWNLOAD_CHOICES: readonly { value: DownloadPolicy; title: string; detail: string }[] = [
  { value: 'open', title: 'free download', detail: 'anyone who can listen can download the original.' },
  { value: 'ask', title: 'free, but ask for support first', detail: 'the download shows your support and buy links before it starts.' },
  { value: 'supporters', title: 'supporters only', detail: 'people with a verified payment to you can download it.' },
  { value: 'off', title: 'no downloads', detail: 'only you can download it. people can still record what they hear.' },
];

/** the download choices a track can have: a closed track's file stays in its space, where only supporter downloads reach it */
export function downloadChoices(access: AccessDraft) {
  return access.closed ? DOWNLOAD_CHOICES.filter(choice => choice.value === 'supporters' || choice.value === 'off') : DOWNLOAD_CHOICES;
}

/** the download setting in effect: what the artist picked, if this track can have it, else its default */
export function downloadsFor(access: AccessDraft, picked: DownloadPolicy | undefined, plyrStorage = false): DownloadPolicy {
  if (plyrStorage) return 'open';
  if (access.closed) return picked === 'supporters' ? 'supporters' : 'off';
  return picked ?? 'open';
}

/** "where else you sell it": a link listeners can open; a sale there never opens the track here */
/** where else a track is sold: a link only. plyr.fm can't check a price there, so it asks for none. */
export interface SellDraft { url: string }

export function sellProblem(sell: SellDraft | undefined): string | undefined {
  if (!sell) return undefined;
  if (!normalizeLink(sell.url)) return 'use a full link, like https://you.bandcamp.com/track/name.';
  return undefined;
}

export function buyLinkFor(sell: SellDraft | undefined): BuyLink | undefined {
  if (!sell || sellProblem(sell)) return undefined;
  return { url: normalizeLink(sell.url)! };
}

/** a saved draft's sell row, or none */
export function readSellDraft(value: unknown): SellDraft | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const { url } = value as Record<string, unknown>;
  return typeof url === 'string' ? { url } : undefined;
}

export function sellFromLink(link: BuyLink | undefined): SellDraft | undefined {
  return link ? { url: link.url } : undefined;
}

/** the rest of who gets the track: downloads, feeds, and where else it's sold */
export interface UploadOptions { downloads?: DownloadPolicy; listed: boolean; sell?: SellDraft }
export const DEFAULT_OPTIONS: UploadOptions = { listed: true };

export function readUploadOptions(value: unknown): UploadOptions {
  if (!value || typeof value !== 'object') return { ...DEFAULT_OPTIONS };
  const { downloads, listed, sell } = value as Record<string, unknown>;
  const picked = DOWNLOAD_CHOICES.find(choice => choice.value === downloads)?.value;
  // a saved choice that can't be read stays narrow: out of feeds, no downloads
  return { listed: listed === undefined || listed === true, ...(downloads === undefined ? {} : { downloads: picked ?? 'off' }), ...(readSellDraft(sell) ? { sell: readSellDraft(sell) } : {}) };
}

/** what an upload sends for these options; an only-you track has none of them */
export function optionsInput(options: UploadOptions, access: AccessDraft, plyrStorage: boolean, currency = UPLOAD_CURRENCY): { downloadPolicy?: DownloadPolicy; unlisted?: true; buyLink?: BuyLink } {
  if (onlyYou(access)) return {};
  const buyLink = buyLinkFor(options.sell);
  const downloadPolicy = options.downloads === undefined && !access.closed ? undefined : downloadsFor(access, options.downloads, plyrStorage);
  return { ...(downloadPolicy ? { downloadPolicy } : {}), ...(options.listed ? {} : { unlisted: true as const }), ...(buyLink ? { buyLink } : {}) };
}

export function optionsFromInput(input: { downloadPolicy?: DownloadPolicy; unlisted?: boolean; buyLink?: BuyLink }): UploadOptions {
  const sell = sellFromLink(input.buyLink);
  return { listed: !input.unlisted, ...(input.downloadPolicy ? { downloads: input.downloadPolicy } : {}), ...(sell ? { sell } : {}) };
}
