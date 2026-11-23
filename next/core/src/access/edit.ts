import { describePolicy, formatPrice, sameRule, type Policy, type Rule } from './policy.ts';

// the who can listen page: one draft of the ways in the artist picks, and the
// policy writes that turn what's on their PDS into it. a policy this page didn't
// write (titled, tied to a release, brokered, or shared with other tracks) is left
// exactly as it is and shown as "also".

export interface AccessDraft {
  everyone: boolean;
  /** people the artist picked, as DIDs, in the order they were added */
  members: string[];
  supporter: boolean;
  /** smallest currency unit; undefined when buyers aren't a way in */
  purchase?: { amount: number; currency: string };
  signedIn: boolean;
}

/** a policy this page owns: a plain rule for this one space */
export function editable(policy: Policy): boolean {
  const brokers = policy.rule.kind === 'supporter' || policy.rule.kind === 'purchase' ? policy.rule.brokers : undefined;
  return policy.spaces.length === 1 && !policy.title && !policy.subject && !brokers;
}

/** the draft a track's current policies (or its legacy fallback rule) describe */
export function draftFrom(open: boolean, policies: Policy[], fallback?: Rule): { draft: AccessDraft; fixed: Policy[] } {
  const own = policies.filter(editable);
  const rules = own.length || policies.length ? own.map(policy => policy.rule) : fallback ? [fallback] : [];
  const members = [...new Set(rules.flatMap(rule => rule.kind === 'members' ? rule.members : []))];
  const purchase = rules.find(rule => rule.kind === 'purchase');
  return {
    draft: {
      everyone: open, members,
      supporter: rules.some(rule => rule.kind === 'supporter'),
      ...(purchase ? { purchase: { amount: purchase.amount, currency: purchase.currency } } : {}),
      signedIn: rules.some(rule => rule.kind === 'signedIn'),
    },
    fixed: policies.filter(policy => !editable(policy)),
  };
}

/** the rules a draft asks for; empty means only the artist (and any fixed policies) */
export function draftRules(draft: AccessDraft): Rule[] {
  const rules: Rule[] = [];
  if (draft.members.length) rules.push({ kind: 'members', members: [...new Set(draft.members)] });
  if (draft.supporter) rules.push({ kind: 'supporter' });
  if (draft.purchase) rules.push({ kind: 'purchase', ...draft.purchase });
  if (draft.signedIn) rules.push({ kind: 'signedIn' });
  return rules;
}

/** the writes that make a closed track's own policies match the draft */
export function accessPlan(policies: Policy[], draft: AccessDraft): { add: Rule[]; remove: Policy[] } {
  const own = policies.filter(editable);
  const wanted = draftRules(draft);
  const kept = new Set<Policy>();
  const add = wanted.filter(rule => {
    const match = own.find(policy => !kept.has(policy) && sameRule(policy.rule, rule));
    if (match) kept.add(match);
    return !match;
  });
  return { add, remove: own.filter(policy => !kept.has(policy)) };
}

/** one plain sentence for who can listen, naming picked people by `name` */
export function accessSummary(draft: AccessDraft, fixed: Pick<Policy, 'rule' | 'title'>[], name: (did: string) => string): string {
  if (draft.everyone) return 'anyone with the link can listen.';
  const parts: string[] = [];
  if (draft.members.length) {
    const names = draft.members.slice(0, 3).map(name);
    const rest = draft.members.length - names.length;
    parts.push(...(rest ? [...names, rest === 1 ? '1 other person' : `${rest} other people`] : names));
  }
  if (draft.supporter) parts.push('your supporters');
  if (draft.purchase) parts.push(`anyone who buys it for ${formatPrice(draft.purchase.amount, draft.purchase.currency)}`);
  if (draft.signedIn) parts.push('anyone signed in');
  parts.push(...fixed.map(describePolicy));
  if (!parts.length) return 'only you can listen.';
  const list = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;
  return `${list} can listen. everyone else sees the cover and the ways in.`;
}
