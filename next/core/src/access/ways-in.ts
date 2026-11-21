import { formatPrice, type Policy, type Rule } from './policy.ts';
import { offerLabel, storeName, type Offer } from '../selling.ts';

// what a listener who can't open a closed track sees instead of an error:
// every way in the artist offers, each one something to do.

export interface WayIn {
  key: string;
  kind: 'buy' | 'support' | 'sign-in' | 'members' | 'supporter' | 'purchase';
  title: string;
  detail: string;
  /** an outside link (buy / support) */
  url?: string;
  /** the button word, when there is something to press */
  action?: string;
}

export interface WaysInInput {
  artist: string;
  /** the artist's policies for this track's space; a legacy fallback rule counts as one */
  rules: (Pick<Policy, 'rule' | 'title'> | { rule: Rule; title?: string })[];
  offer?: Offer;
  support?: string;
  /** the listener's did, when signed in */
  viewer?: string;
}

/** whether a rule already lets this listener in, as far as the rules alone can tell */
function admits(rule: Rule, viewer: string | undefined): boolean {
  if (!viewer) return false;
  return rule.kind === 'signedIn' || (rule.kind === 'members' && rule.members.includes(viewer));
}

/**
 * every way in, for a listener the rules don't already admit. `admitted` means the
 * panel has nothing to say (they can listen); a paid rule can't be known here.
 */
export function waysIn({ artist, rules, offer, support, viewer }: WaysInInput): { ways: WayIn[]; note?: string; admitted: boolean } {
  if (rules.some(({ rule }) => admits(rule, viewer))) return { ways: [], admitted: true };
  const ways: WayIn[] = [];
  if (offer) ways.push({ key: 'buy', kind: 'buy', title: 'buy it', detail: offerLabel(offer), url: offer.url, action: 'buy' });
  if (support) ways.push({ key: 'support', kind: 'support', title: `support ${artist}`, detail: `on ${storeName(support)}`, url: support, action: 'support' });
  rules.forEach(({ rule, title }, index) => {
    const key = `${rule.kind}-${index}`;
    if (rule.kind === 'signedIn') ways.push({ key, kind: 'sign-in', title: title ?? 'anyone signed in', detail: 'sign in to listen', action: 'sign in' });
    else if (rule.kind === 'members') ways.push({ key, kind: 'members', title: title ?? `people ${artist} listed`, detail: `ask ${artist} to add you` });
    else if (rule.kind === 'supporter') ways.push({ key, kind: 'supporter', title: title ?? `supporters of ${artist}`, detail: 'any verified payment to them opens it' });
    else if (rule.kind === 'purchase') ways.push({ key, kind: 'purchase', title: title ?? 'buyers', detail: `a verified purchase of ${formatPrice(rule.amount, rule.currency)} or more opens it` });
  });
  // a plain link is never verified, so buying there never opens the track here, whatever the rules say
  const note = offer?.provider === 'link' ? `buying ${offerLabel(offer)} gets you the files there. it doesn't unlock this track on plyr.fm.` : undefined;
  return { ways, ...(note ? { note } : {}), admitted: false };
}
