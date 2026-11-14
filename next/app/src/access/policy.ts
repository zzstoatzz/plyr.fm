import type { Track } from '../../../core/src/api.ts';
import { parsePolicy as parse, policyRecord as record, trackSpace as space, type Rule } from '../../../core/src/access/policy.ts';
import { AUDIO_SPACE_TYPE, NSID } from '../auth-config.ts';

export { describePolicy, describeRule, formatPrice, implicitRule, isOpen, parsePrice, spaceParts } from '../../../core/src/access/policy.ts';
export type { Policy, Rule } from '../../../core/src/access/policy.ts';

export function trackSpace(track: Track) {
  return space(track, AUDIO_SPACE_TYPE);
}

export function parsePolicy(item: unknown, author: string) {
  return parse(item, author, { audioSpaceType: AUDIO_SPACE_TYPE, policyCollection: NSID.policy });
}

export function policyRecord(space: string, rule: Rule, title?: string) {
  return record(NSID.policy, space, rule, title);
}
