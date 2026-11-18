import type { Track } from '../api.ts';

// mirrors next/backend/src/internal/space/policy.zig: strict parse, unknown
// rules ignored, passing any one policy opens every space it names.

export type Rule =
  | { kind: 'signedIn' }
  | { kind: 'members'; members: string[] }
  | { kind: 'supporter'; brokers?: string[] }
  | { kind: 'purchase'; amount: number; currency: string; brokers?: string[] };

/** `spaces` are the spaces this policy opens; `subject` is the release or track it sells or grants, when named */
export interface Policy { uri: string; cid: string; rkey: string; spaces: string[]; rule: Rule; title?: string; subject?: string }

const MAX_SPACES = 16;

const DID = /^did:[a-z]+:[a-zA-Z0-9._:%-]+$/;
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const dids = (value: unknown, min: number, max: number) => Array.isArray(value) && value.length >= min && value.length <= max
  && value.every(item => typeof item === 'string' && DID.test(item)) ? value as string[] : undefined;

export function spaceParts(uri: string): { authority: string; type: string; skey: string } | undefined {
  const match = /^at:\/\/(did:[^/]+)\/space\/([^/]+)\/([^/]+)$/.exec(uri);
  return match ? { authority: match[1], type: match[2], skey: match[3] } : undefined;
}

/** the space a track's audio is closed in, if it is one policies can open */
export function trackSpace(track: Track, audioSpaceType: string): string | undefined {
  const space = track.access.space_uri;
  const parts = space ? spaceParts(space) : undefined;
  return parts && parts.type === audioSpaceType && parts.authority === track.artist.did ? space! : undefined;
}

export function isOpen(track: Track): boolean {
  return !track.access.space_uri && !track.access.gate && (track.access.visibility === 'public' || track.access.visibility === 'unlisted');
}

/** spaces named by their legacy gate keep working until the artist writes a policy */
export function implicitRule(space: string): Rule | undefined {
  const skey = spaceParts(space)?.skey;
  return skey === 'supporters' ? { kind: 'supporter' } : skey === 'signed-in' ? { kind: 'signedIn' } : undefined;
}

function rule(value: unknown, policyCollection: string): Rule | undefined {
  if (!object(value) || typeof value.$type !== 'string') return undefined;
  const kind = value.$type.startsWith(`${policyCollection}#`) ? value.$type.slice(policyCollection.length + 1) : '';
  const brokers = value.brokers === undefined ? undefined : dids(value.brokers, 1, 16);
  if (value.brokers !== undefined && !brokers) return undefined;
  if (kind === 'signedIn') return { kind };
  if (kind === 'members') { const members = dids(value.members, 0, 512); return members && { kind, members }; }
  if (kind === 'supporter') return { kind, ...(brokers ? { brokers } : {}) };
  if (kind === 'purchase' && Number.isSafeInteger(value.amount) && (value.amount as number) >= 1
    && typeof value.currency === 'string' && /^[A-Z]{3}$/.test(value.currency)) {
    return { kind, amount: value.amount as number, currency: value.currency, ...(brokers ? { brokers } : {}) };
  }
  return undefined;
}

/** one listRecords item from `author`'s repo, or undefined when it opens nothing */
export function parsePolicy(item: unknown, author: string, { audioSpaceType, policyCollection }: { audioSpaceType: string; policyCollection: string }): Policy | undefined {
  if (!object(item) || typeof item.uri !== 'string' || typeof item.cid !== 'string' || !object(item.value)) return undefined;
  const prefix = `at://${author}/${policyCollection}/`;
  if (!item.uri.startsWith(prefix) || item.value.$type !== policyCollection) return undefined;
  const spaces = spaceList(item.value);
  if (!spaces?.every(space => { const parts = spaceParts(space); return parts?.authority === author && parts.type === audioSpaceType; })) return undefined;
  const parsed = rule(item.value.rule, policyCollection);
  if (!parsed) return undefined;
  const title = typeof item.value.title === 'string' && item.value.title.trim() ? item.value.title.trim() : undefined;
  const subject = typeof item.value.subject === 'string' && item.value.subject.startsWith(`at://${author}/`) ? item.value.subject : undefined;
  return { uri: item.uri, cid: item.cid, rkey: item.uri.slice(prefix.length), spaces, rule: parsed, ...(title ? { title } : {}), ...(subject ? { subject } : {}) };
}

/** `spaces`, or the single `space` older records carry; never both */
function spaceList(value: Record<string, unknown>): string[] | undefined {
  if (value.space !== undefined && value.spaces !== undefined) return undefined;
  if (typeof value.space === 'string') return [value.space];
  const list = value.spaces;
  return Array.isArray(list) && list.length >= 1 && list.length <= MAX_SPACES && list.every(entry => typeof entry === 'string') ? list as string[] : undefined;
}

export function policyRecord(policyCollection: string, spaces: string[], value: Rule, title?: string, subject?: string) {
  const { kind, ...fields } = value;
  return {
    $type: policyCollection, spaces, rule: { $type: `${policyCollection}#${kind}`, ...fields },
    ...(title?.trim() ? { title: title.trim() } : {}), ...(subject ? { subject } : {}), createdAt: new Date().toISOString(),
  };
}

export function formatPrice(amount: number, currency: string): string {
  try {
    const format = new Intl.NumberFormat(undefined, { style: 'currency', currency });
    return format.format(amount / 10 ** (format.resolvedOptions().maximumFractionDigits ?? 2));
  } catch { return `${amount} ${currency}`; }
}

/** major-unit text ("5", "4.99") to the currency's smallest unit, or undefined */
export function parsePrice(text: string, currency: string): number | undefined {
  let digits = 2;
  try { digits = new Intl.NumberFormat(undefined, { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2; } catch { return undefined; }
  const match = /^\s*(\d{1,7})(?:[.,](\d+))?\s*$/.exec(text);
  if (!match || (match[2]?.length ?? 0) > digits) return undefined;
  const amount = Number(match[1]) * 10 ** digits + Number((match[2] ?? '').padEnd(digits, '0') || 0);
  return amount >= 1 ? amount : undefined;
}

export function describeRule(value: Rule): string {
  switch (value.kind) {
    case 'signedIn': return 'anyone signed in';
    case 'members': return value.members.length === 1 ? '1 listed person' : `${value.members.length} listed people`;
    case 'supporter': return 'supporters';
    case 'purchase': return `buy for ${formatPrice(value.amount, value.currency)}`;
  }
}

export function describePolicy(policy: Pick<Policy, 'rule' | 'title'>): string {
  return policy.title ?? describeRule(policy.rule);
}
