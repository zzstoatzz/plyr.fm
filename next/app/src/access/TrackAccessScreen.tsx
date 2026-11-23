import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { router, useIsFocused } from 'expo-router';
import type { Track } from '@plyr/next-core/api';
import { trackArtwork } from '@plyr/next-core/artwork';
import { accessPlan, accessSummary, draftFrom, draftRules, type AccessDraft } from '@plyr/next-core/access/edit';
import { priceText } from '@plyr/next-core/access/policy';
import { api } from '../api-client';
import { useAppearance } from '../appearance';
import { useAuth } from '../auth';
import { getAuth } from '../auth-state';
import { Cover, useResource } from '../CatalogPieces';
import { Action, Copy, Field } from '../controls';
import { Check, Globe, Lock, Users } from '../icons';
import { useRadioGroup } from '../behaviors/use-radio-group';
import { FieldError } from '../publishing/UploadPieces';
import { BarButton, Sheet } from '../Sheet';
import { Text } from '../Text';
import { toast } from '../toast';
import { trackAccess } from './close-pds';
import { PeoplePicker, type Person } from './PeoplePicker';
import { addPolicy, listPolicies, removePolicy } from './policy-pds';
import { describePolicy, implicitRule, isOpen, parsePrice, spaceParts, trackSpace, type Policy } from './policy';

type Profiles = { profiles?: { did: string; handle: string; displayName?: string; avatar?: string }[] };

function leave(id: string) { router.canGoBack() ? router.back() : router.replace(`/track/${id}`); }

/** the owner's page for choosing who can listen to one track: everyone, or the ways in they pick */
export function TrackAccessScreen({ id }: { id: string }) {
  const auth = useAuth();
  const focused = useIsFocused();
  const load = useCallback(async () => {
    const track = await api.track(id);
    const space = trackSpace(track);
    const policies = isOpen(track) || !space ? [] : await listPolicies(track.artist.did, space);
    return { track, policies };
  }, [id]);
  const resource = useResource(load);
  const [save, setSave] = useState<{ label: string; disabled: boolean; onPress: () => void }>();
  const busy = useRef(false);
  const close = () => { if (!busy.current) leave(id); };
  const track = resource.data?.track;
  const owner = !!track && auth.did === track.artist.did;
  const ready = owner && !!auth.policyEditing && !!auth.closing;
  const reconnect = () => router.push({ pathname: '/login', params: { return_to: `/who-can-listen/${id}` } });
  return <Sheet title="who can listen" close={close} visible={focused} bar={{
    leading: <BarButton label="Cancel" onPress={close} />,
    trailing: save && <BarButton strong label={save.label} disabled={save.disabled} onPress={save.onPress} />,
  }}>
    {!resource.data ? resource.error
      ? <><Copy live>{resource.error}</Copy>{!resource.gone && <Action label="try again" onPress={resource.retry} />}</>
      : <Copy live>reading who can listen…</Copy>
      : !owner ? <Copy>only the artist can choose who listens to this track.</Copy>
      : !ready ? <><Copy>reconnect to choose who can listen to your tracks.</Copy><Action label="reconnect" primary onPress={reconnect} /></>
      : <AccessForm key={`${auth.did}:${resource.data.policies.map(policy => policy.cid).join()}`} track={resource.data.track} policies={resource.data.policies}
        setSave={setSave} busy={value => { busy.current = value; }} done={() => leave(id)} />}
  </Sheet>;
}

function AccessForm({ track, policies, setSave, busy: markBusy, done }: {
  track: Track; policies: Policy[]; setSave: (save?: { label: string; disabled: boolean; onPress: () => void }) => void; busy: (value: boolean) => void; done: () => void;
}) {
  const theme = useAppearance();
  const auth = useAuth();
  const open = isOpen(track);
  const space = trackSpace(track);
  const fallback = space ? implicitRule(space) : undefined;
  const shared = !!space && spaceParts(space)?.skey !== track.record.rkey;
  const [start] = useState(() => draftFrom(open, policies, fallback));
  const [everyone, setEveryone] = useState(start.draft.everyone);
  const [people, setPeople] = useState<Person[]>(() => start.draft.members.map(did => ({ did })));
  const [supporter, setSupporter] = useState(start.draft.supporter);
  const [buyers, setBuyers] = useState(!!start.draft.purchase);
  const currency = start.draft.purchase?.currency ?? 'USD';
  const [price, setPrice] = useState(start.draft.purchase ? priceText(start.draft.purchase.amount, currency) : '');
  const [signedIn, setSignedIn] = useState(start.draft.signedIn);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [priceError, setPriceError] = useState<string>();

  useEffect(() => {
    const dids = start.draft.members;
    if (!dids.length) return;
    const controller = new AbortController();
    void (async () => {
      for (let index = 0; index < dids.length; index += 25) {
        const query = new URLSearchParams(dids.slice(index, index + 25).map(did => ['actors', did]));
        const found: Profiles = await fetch(`https://public.api.bsky.app/xrpc/app.bsky.actor.getProfiles?${query}`, { signal: controller.signal })
          .then(response => response.ok ? response.json() as Promise<Profiles> : {}).catch(() => ({}));
        if (controller.signal.aborted) return;
        const byDid = new Map((found.profiles ?? []).map(profile => [profile.did, profile]));
        setPeople(current => current.map(person => {
          const profile = byDid.get(person.did);
          return profile && !person.handle ? { did: person.did, handle: profile.handle, name: profile.displayName?.trim() || undefined, avatar: profile.avatar } : person;
        }));
      }
    })();
    return () => controller.abort();
  }, [start]);

  const amount = buyers ? parsePrice(price, currency) : undefined;
  const draft: AccessDraft = { everyone, members: people.map(person => person.did), supporter, ...(amount ? { purchase: { amount, currency } } : {}), signedIn };
  const key = (value: AccessDraft) => JSON.stringify(value.everyone ? { everyone: true } : { ...value, members: [...value.members].sort() });
  const dirty = key(draft) !== key(start.draft) || (buyers && !amount);
  const label = (did: string) => { const person = people.find(other => other.did === did); return person?.name ?? (person?.handle ? `@${person.handle}` : 'someone'); };
  const summary = accessSummary(draft, start.fixed, label);

  async function save() {
    setError(undefined);
    if (buyers && !amount) { setPriceError('enter a price, like 5 or 4.99.'); return; }
    // a space closed the old way lets its fallback in until some policy exists
    if (!everyone && fallback && !policies.length && !draftRules(draft).length) { setError('pick at least one way in.'); return; }
    setBusy(true); markBusy(true);
    try {
      const session = getAuth();
      if (session.did !== auth.did) throw new Error('account changed. return to the original account.');
      const access = trackAccess(session);
      if (everyone) {
        if (!open) await access.reopen([track.record.uri]);
      } else {
        let target = space;
        let current = policies;
        if (open) {
          target = await access.close([track.record.uri], track.record.rkey);
          current = await listPolicies(track.artist.did, target);
        }
        const plan = accessPlan(current, draft);
        for (const rule of plan.add) await addPolicy(session, target!, rule);
        for (const policy of plan.remove) await removePolicy(session, policy);
      }
      toast.success(everyone ? 'anyone with the link can listen again.' : 'saved who can listen.');
      markBusy(false);
      done();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'could not save that. try again.');
      markBusy(false);
    } finally { setBusy(false); }
  }
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    setSave({ label: busy ? 'Saving…' : 'Save', disabled: busy || !dirty, onPress: () => void saveRef.current() });
    return () => setSave(undefined);
  }, [busy, dirty, setSave]);

  const mode = useRadioGroup({ label: 'Who can listen', value: everyone, onChange: setEveryone, disabled: busy });
  const small = { color: theme.muted, fontFamily: theme.fontFamily, fontSize: 13 * theme.scale, lineHeight: 18 * theme.scale };
  return <View style={{ gap: 18 }}>
    <View style={styles.top}>
      <Cover uri={trackArtwork(track)} size={56} radius={8} />
      <Text numberOfLines={2} style={{ flex: 1, color: theme.text, fontFamily: theme.fontFamily, fontSize: 17 * theme.scale, fontWeight: '700' }}>{track.metadata.title}</Text>
    </View>
    <View {...mode.group} style={{ gap: 10 }}>
      <Choice radio={mode.option(true)} selected={everyone} icon={<Globe size={20} color={everyone ? theme.accent : theme.muted} />}
        title="everyone" detail="anyone with the link, signed in or not" />
      <Choice radio={mode.option(false)} selected={!everyone} icon={<Lock size={20} color={!everyone ? theme.accent : theme.muted} />}
        title="only some people" detail="pick the ways in below" />
    </View>
    {!everyone && <View accessibilityLabel="Ways in" style={[styles.ways, { borderColor: theme.line, backgroundColor: theme.surface }]}>
      <View style={styles.way}>
        <View style={styles.head}>
          <Users size={20} color={people.length ? theme.accent : theme.muted} />
          <View style={{ flex: 1 }}>
            <Text style={{ color: theme.text, fontFamily: theme.fontFamily, fontSize: 16 * theme.scale, fontWeight: '700' }}>people you pick</Text>
            <Text style={small}>{people.length ? (people.length === 1 ? '1 person' : `${people.length} people`) : 'search by name or handle'}</Text>
          </View>
        </View>
        <PeoplePicker people={people} change={setPeople} owner={track.artist.did} disabled={busy} />
      </View>
      <Divider />
      <Choice selected={supporter} disabled={busy} onPress={() => setSupporter(!supporter)} title="your supporters" detail="anyone who supports you through your support link" />
      <Divider />
      <Choice selected={buyers} disabled={busy} onPress={() => { setBuyers(!buyers); setPriceError(undefined); }} title="people who buy it" detail="they can listen once they pay" />
      {buyers && <View style={{ gap: 6, paddingHorizontal: 14, paddingBottom: 12 }}>
        <Field label={`price (${currency})`} value={price} onChangeText={value => { setPrice(value); setPriceError(undefined); }} editable={!busy}
          keyboardType="decimal-pad" autoCorrect={false} placeholder="5" />
        {priceError && <FieldError>{priceError}</FieldError>}
      </View>}
      <Divider />
      <Choice selected={signedIn} disabled={busy} onPress={() => setSignedIn(!signedIn)} title="anyone signed in" detail="keeps it off the open web" />
      {start.fixed.length > 0 && <>
        <Divider />
        <View style={{ padding: 14, gap: 4 }}>
          <Text style={small}>also, set up elsewhere</Text>
          {start.fixed.map(policy => <Text key={policy.uri} style={{ color: theme.text, fontFamily: theme.fontFamily, fontSize: 15 * theme.scale }}>{describePolicy(policy)}</Text>)}
        </View>
      </>}
    </View>}
    <View accessibilityLiveRegion="polite" style={styles.summary}>
      {everyone ? <Globe size={16} color={theme.muted} /> : <Lock size={16} color={theme.muted} />}
      <Text style={{ flex: 1, color: theme.muted, fontFamily: theme.fontFamily, fontSize: 15 * theme.scale, lineHeight: 21 * theme.scale }}>{summary}</Text>
    </View>
    {shared && !everyone && <Text style={small}>this track was closed together with others, so their ways in change too.</Text>}
    {error && <FieldError>{error}</FieldError>}
  </View>;
}

function Divider() {
  const theme = useAppearance();
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: theme.line }} />;
}

/** a row with a title and a line under it; a radio button in a group, a checkbox on its own */
function Choice({ title, detail, selected, onPress, disabled, icon, radio }: {
  title: string; detail: string; selected: boolean; onPress?: () => void; disabled?: boolean; icon?: ReactNode;
  /** this choice's props from useRadioGroup; without them it's a checkbox */ radio?: ReturnType<ReturnType<typeof useRadioGroup<boolean>>['option']>;
}) {
  const off = radio ? radio.disabled : disabled;
  const theme = useAppearance();
  const mark = radio
    ? <View style={[styles.radio, { borderColor: selected ? theme.accent : theme.border }]}>{selected && <View style={[styles.dot, { backgroundColor: theme.accent }]} />}</View>
    : <View style={[styles.box, { borderColor: selected ? theme.accent : theme.border, backgroundColor: selected ? theme.accent : 'transparent' }]}>
      {selected && <Check size={15} color={theme.onAccent} strokeWidth={3} />}
    </View>;
  const control = radio ?? { accessibilityRole: 'checkbox' as const, accessibilityState: { checked: selected, disabled }, disabled, onPress };
  return <Pressable {...control} accessibilityLabel={`${title}, ${detail}`}
    style={({ pressed }) => [styles.choice, radio && { borderWidth: selected ? 1.5 : 1, borderColor: selected ? theme.accent : theme.line, backgroundColor: theme.surface, borderRadius: 12 },
      { opacity: off ? 0.5 : pressed ? 0.7 : 1 }]}>
    {icon}
    <View style={{ flex: 1, minWidth: 0 }}>
      <Text style={{ color: theme.text, fontFamily: theme.fontFamily, fontSize: 16 * theme.scale, fontWeight: '700' }}>{title}</Text>
      <Text style={{ color: theme.muted, fontFamily: theme.fontFamily, fontSize: 13 * theme.scale, lineHeight: 18 * theme.scale }}>{detail}</Text>
    </View>
    {mark}
  </Pressable>;
}

const styles = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  ways: { borderWidth: 1, borderRadius: 12, overflow: 'hidden' },
  way: { padding: 14, gap: 12 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  choice: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, paddingHorizontal: 14, paddingVertical: 10 },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 12, height: 12, borderRadius: 6 },
  box: { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  summary: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
});
