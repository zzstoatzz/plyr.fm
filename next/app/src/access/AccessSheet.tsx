import { useState } from 'react';
import { View } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import Trash from 'lucide-react-native/icons/trash';
import type { Track } from '../api';
import { useAuth } from '../auth';
import { Action, Copy, Field } from '../controls';
import { ActionRow } from '../ActionRow';
import { Sheet } from '../Sheet';
import { toast } from '../toast';
import { addPolicy, memberDid, removePolicy } from './policy-pds';
import { trackAccess } from './close-pds';
import { describePolicy, describeRule, isOpen, parsePrice, trackSpace, type Rule } from './policy';
import { useSpacePolicies } from './use-track-access';

type Draft = 'members' | 'purchase' | undefined;
const CURRENCY = 'USD';

/** anything that can be closed: a track, an album, a playlist */
export interface AccessSubject { noun: string; tracks: Track[]; skey: string; returnTo: Href }

/** the space every owned track shares, if they all share one */
function sharedSpace(tracks: Track[]): string | undefined {
  const spaces = new Set(tracks.map(trackSpace));
  return spaces.size === 1 ? [...spaces][0] : undefined;
}

/** the artist's view of who can listen to something, and how to change it */
export function AccessSheet({ subject, close }: { subject: AccessSubject; close: () => void }) {
  const auth = useAuth();
  const router = useRouter();
  const owned = subject.tracks.filter(track => track.artist.did === auth.did);
  const [closedInto, setClosedInto] = useState<string>();
  const [reopened, setReopened] = useState(false);
  const space = reopened ? undefined : closedInto ?? sharedSpace(owned);
  const { policies, fallback, error, reload } = useSpacePolicies(auth.did ?? '', space);
  const [draft, setDraft] = useState<Draft>();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  async function run(work: () => Promise<void>, done: string) {
    setBusy(true);
    try { await work(); toast.success(done); setDraft(undefined); setText(''); reload(); }
    catch (failure) { toast.error(failure instanceof Error ? failure.message : 'could not save that. try again.'); }
    finally { setBusy(false); }
  }
  const add = (rule: Rule) => run(() => addPolicy(auth, space!, rule), `${describeRule(rule)} can now listen`);
  async function addDraft() {
    if (draft === 'purchase') {
      const amount = parsePrice(text, CURRENCY);
      if (!amount) { toast.error('enter a price, like 5 or 4.99.'); return; }
      await add({ kind: 'purchase', amount, currency: CURRENCY });
    } else if (draft === 'members') {
      const names = text.split(/[\s,]+/).filter(Boolean);
      if (!names.length) { toast.error('enter at least one handle.'); return; }
      await run(async () => {
        const members = [...new Set(await Promise.all(names.map(memberDid)))];
        await addPolicy(auth, space!, { kind: 'members', members });
      }, names.length === 1 ? `${names[0]} can now listen` : `${names.length} people can now listen`);
    }
  }
  const closeAll = () => run(async () => {
    setClosedInto(await trackAccess(auth).close(owned.filter(isOpen).map(track => track.record.uri), subject.skey));
    setReopened(false);
  }, `closed this ${subject.noun}. only you can listen until you let people in.`);
  const reopenAll = () => run(async () => {
    await trackAccess(auth).reopen(owned.filter(track => !isOpen(track) || closedInto).map(track => track.record.uri));
    setReopened(true); setClosedInto(undefined);
  }, `this ${subject.noun} is open to everyone again.`);
  function reconnect() { close(); router.push({ pathname: '/login', params: { return_to: typeof subject.returnTo === 'string' ? subject.returnTo : '/' } }); }

  const openCount = reopened ? owned.length : closedInto ? 0 : owned.filter(isOpen).length;
  const elsewhere = closedInto || reopened ? 0 : owned.filter(track => !isOpen(track) && trackSpace(track) !== space).length;
  if (!auth.policyEditing || !auth.closing) return <Sheet title="who can listen" close={close}>
    <Copy>reconnect to choose who can listen to your music.</Copy>
    <Action label="reconnect" primary onPress={reconnect} />
  </Sheet>;
  if (!space) return <Sheet title="who can listen" close={close}>
    <Copy>{openCount === owned.length ? `this ${subject.noun} is open to everyone.` : `${openCount} of ${owned.length} tracks are open to everyone; ${elsewhere} already have their own access.`}</Copy>
    {openCount > 0 && <>
      <Copy>close it to choose who can listen: people you list, supporters, buyers, or anyone signed in.</Copy>
      <Action label={`close this ${subject.noun}`} primary disabled={busy} onPress={() => void closeAll()} />
    </>}
  </Sheet>;

  return <Sheet title="who can listen" close={close}>
    {error ? <View style={{ gap: 10 }}><Copy live>{error}</Copy><Action label="try again" onPress={reload} /></View>
      : !policies ? <Copy live>reading who can listen…</Copy>
      : policies.length ? <View>
        {policies.map(policy => <ActionRow key={policy.uri} icon={Trash} disabled={busy}
          label={`remove: ${describePolicy(policy)}`} onPress={() => run(() => removePolicy(auth, policy), `removed ${describePolicy(policy)}`)} />)}
      </View>
      : <Copy>{fallback ? `${describeRule(fallback)} can listen. adding a way in below replaces that.` : 'only you can listen right now.'}</Copy>}
    {draft ? <View style={{ gap: 10 }}>
      <Field label={draft === 'purchase' ? `price (${CURRENCY})` : 'handles, separated by commas'} value={text} onChangeText={setText}
        autoCapitalize="none" autoCorrect={false} keyboardType={draft === 'purchase' ? 'decimal-pad' : 'default'}
        placeholder={draft === 'purchase' ? '5' : 'friend.bsky.social'} onSubmitEditing={() => void addDraft()} />
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <Action label="add" primary disabled={busy} onPress={() => void addDraft()} />
        <Action label="cancel" disabled={busy} onPress={() => { setDraft(undefined); setText(''); }} />
      </View>
    </View> : policies && <View style={{ gap: 10 }}>
      <Copy>let people in by</Copy>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
        <Action label="listing them" disabled={busy} onPress={() => setDraft('members')} />
        <Action label="supporting you" disabled={busy || policies.some(policy => policy.rule.kind === 'supporter')} onPress={() => void add({ kind: 'supporter' })} />
        <Action label="buying it" disabled={busy} onPress={() => setDraft('purchase')} />
        <Action label="signing in" disabled={busy || policies.some(policy => policy.rule.kind === 'signedIn')} onPress={() => void add({ kind: 'signedIn' })} />
      </View>
      <Action label="open to everyone" disabled={busy} onPress={() => void reopenAll()} />
    </View>}
  </Sheet>;
}
