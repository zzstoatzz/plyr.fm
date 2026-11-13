import { useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import Trash from 'lucide-react-native/icons/trash';
import type { Track } from '../api';
import { useAuth } from '../auth';
import { Action, Copy, Field } from '../controls';
import { ActionRow } from '../ActionRow';
import { Sheet } from '../Sheet';
import { toast } from '../toast';
import { addPolicy, memberDid, removePolicy } from './policy-pds';
import { describePolicy, describeRule, parsePrice, type Rule } from './policy';
import { useTrackAccess } from './use-track-access';

type Draft = 'members' | 'purchase' | undefined;
const CURRENCY = 'USD';

/** the artist's view of who can listen to one closed track, and how to change it */
export function AccessSheet({ track, close }: { track: Track; close: () => void }) {
  const auth = useAuth();
  const router = useRouter();
  const access = useTrackAccess(track);
  const [draft, setDraft] = useState<Draft>();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  if (access.state !== 'closed' || !access.space) return null;
  const { space, policies, fallback, error, reload } = access;

  async function run(work: () => Promise<void>, done: string) {
    setBusy(true);
    try { await work(); toast.success(done); setDraft(undefined); setText(''); reload(); }
    catch (failure) { toast.error(failure instanceof Error ? failure.message : 'could not save that. try again.'); }
    finally { setBusy(false); }
  }
  const add = (rule: Rule) => run(() => addPolicy(auth, space, rule), `${describeRule(rule)} can now listen`);
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
        await addPolicy(auth, space, { kind: 'members', members });
      }, names.length === 1 ? `${names[0]} can now listen` : `${names.length} people can now listen`);
    }
  }
  function reconnect() { close(); router.push({ pathname: '/login', params: { return_to: `/track/${track.id}` } }); }

  return <Sheet title="who can listen" close={close}>
    {!auth.policyEditing ? <View style={{ gap: 10 }}>
      <Copy>reconnect to change who can listen to your music.</Copy>
      <Action label="reconnect" primary onPress={reconnect} />
    </View> : <>
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
        <Copy>this covers every track that shares this one's access.</Copy>
      </View>}
    </>}
  </Sheet>;
}
