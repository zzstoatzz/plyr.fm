import { ok } from '@atcute/client';
import type { Auth } from '../auth-state';
import { AUDIO_SPACE_TYPE, NSID } from '../auth-config';
import { listPolicies as listSpacePolicies } from '@plyr/next-core/access/policy-read';
import { policyRecord, type Policy, type Rule } from './policy';

const collection = () => NSID.policy as `${string}.${string}.${string}`;

export { memberDid } from '@plyr/next-core/access/policy-read';

/** every valid policy `author` wrote for `space`, read from their public repo */
export function listPolicies(author: string, space: string, signal?: AbortSignal): Promise<Policy[]> {
  return listSpacePolicies({ policyCollection: NSID.policy, audioSpaceType: AUDIO_SPACE_TYPE }, author, space, signal);
}

function session(auth: Auth) {
  if (!auth.did || !auth.rpc) throw new Error('sign in to change who can listen.');
  if (!auth.policyEditing) throw new Error('sign in again to allow changing who can listen.');
  return { did: auth.did, rpc: auth.rpc };
}

export async function addPolicy(auth: Auth, space: string, rule: Rule, title?: string): Promise<void> {
  const { did, rpc } = session(auth);
  if (!space.startsWith(`at://${did}/space/`)) throw new Error('you can only open your own music.');
  await ok(rpc.post('com.atproto.repo.createRecord', { input: { repo: did, collection: collection(), record: policyRecord([space], rule, title) } }));
}

export async function removePolicy(auth: Auth, policy: Policy): Promise<void> {
  const { did, rpc } = session(auth);
  if (!policy.uri.startsWith(`at://${did}/`)) throw new Error('you can only change your own music.');
  await ok(rpc.post('com.atproto.repo.deleteRecord', { input: { repo: did, collection: collection(), rkey: policy.rkey, swapRecord: policy.cid } }));
}
