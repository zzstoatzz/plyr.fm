import type { Track } from '@plyr/next-core/api';
import { parsePolicy as parse, policyRecord as record, trackSpace as space, type Rule } from '@plyr/next-core/access/policy';
import { AUDIO_SPACE_TYPE, NSID } from '../auth-config.ts';

export { describePolicy, describeRule, formatPrice, implicitRule, isOpen, parsePrice, spaceParts } from '@plyr/next-core/access/policy';
export type { Policy, Rule } from '@plyr/next-core/access/policy';

export function trackSpace(track: Track) {
  return space(track, AUDIO_SPACE_TYPE);
}

export function parsePolicy(item: unknown, author: string) {
  return parse(item, author, { audioSpaceType: AUDIO_SPACE_TYPE, policyCollection: NSID.policy });
}

export function policyRecord(space: string, rule: Rule, title?: string) {
  return record(NSID.policy, space, rule, title);
}
