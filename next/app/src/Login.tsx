import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Image, View } from 'react-native';
import { createAccount, login, useAuth } from './auth';
import { Action, Copy, InlineLink, Page, row } from './controls';
import { returnPath } from './return-path';
import { AccountPicker, type AccountSuggestion } from './AccountPicker';
import { ACCOUNT_PROVIDERS, signInPreview, type SignInPreview } from './sign-in-preview';

const typeahead = 'https://typeahead.waow.tech/xrpc/app.bsky.actor.searchActorsTypeahead';


export default function Login() {
  const auth = useAuth();
  const { deviceOnly, return_to } = useLocalSearchParams<{ deviceOnly?: string; return_to?: string }>();
  const intent = returnPath(return_to);
  const [showHelp, setShowHelp] = useState(false);
  const [creating, setCreating] = useState(false);
  const [handle, setHandle] = useState('');
  const [actors, setActors] = useState<AccountSuggestion[]>([]);
  const [chosen, setChosen] = useState<AccountSuggestion>();
  const [preview, setPreview] = useState<SignInPreview>();
  const [provider, setProvider] = useState(ACCOUNT_PROVIDERS[0]);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [slow, setSlow] = useState(false);
  const pending = useRef(false);
  const identifier = handle.trim().replace(/^at:\/\//, '').replace(/^@/, '');

  useEffect(() => {
    if (creating || busy || identifier.length < 2) return;
    const controller = new AbortController();
    const { signal } = controller;
    const query = encodeURIComponent(identifier);
    const timer = setTimeout(() => {
      if (identifier.includes('.') || identifier.startsWith('did:')) {
        void signInPreview(identifier, signal)
          .then(account => { if (account && !signal.aborted) { setPreview(account); setActors([]); } })
          .catch(() => {});
      }
      if (!chosen && !identifier.startsWith('did:')) {
        void fetch(typeahead + '?q=' + query + '&limit=5', { signal, headers: { 'X-Client': 'next.plyr.fm' } })
          .then(async response => {
            if (!response.ok) return;
            const result: { actors?: AccountSuggestion[] } = await response.json();
            if (!signal.aborted) setActors(result.actors ?? []);
          }).catch(() => {});
      }
    }, 300);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [identifier, creating, busy, chosen]);

  useEffect(() => {
    if (!busy) return;
    const timer = setTimeout(() => setSlow(true), 4000);
    return () => clearTimeout(timer);
  }, [busy]);

  function updateHandle(value: string) {
    setHandle(value);
    setChosen(undefined);
    setPreview(undefined);
    setActors([]);
    setError(undefined);
  }

  async function submit(localOnly = deviceOnly === 'true') {
    if (pending.current || (!creating && !identifier)) return;
    pending.current = true;
    setBusy(true);
    setSlow(false);
    setError(undefined);
    try {
      const destination = typeof intent === 'string' ? intent : undefined;
      if (creating) await createAccount(provider.url, destination);
      else await login(identifier, localOnly, destination);
      router.replace(intent ?? '/settings');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'could not continue. please try again.');
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  const host = creating ? provider.name : preview?.sign_in_host;
  return <Page title={creating ? 'create account' : 'sign in to plyr.fm'}>
    <View style={row}>
      <Action label="sign in" selected={!creating} disabled={busy} onPress={() => { setCreating(false); setShowHelp(false); setError(undefined); }} />
      <Action label="create account" selected={creating} disabled={busy} onPress={() => { setCreating(true); setShowHelp(false); setError(undefined); }} />
    </View>
    {creating ? <>
      <Copy>choose a <InlineLink href="https://at-me.zzstoatzz.io/view/?handle=zzstoatzz.io">home</InlineLink> for your data</Copy>
      {ACCOUNT_PROVIDERS.map(item => <View key={item.url} style={{ gap: 6 }}>
        <Action label={item.name + (item.recommended ? ' · recommended' : '')} selected={item.url === provider.url}
          disabled={busy} onPress={() => setProvider(item)} />
        {item.description && <Copy>{item.info_url ? <InlineLink href={item.info_url}>{item.description}</InlineLink> : item.description}</Copy>}
      </View>)}
      <Copy><InlineLink href="https://bsky.app">Bluesky</InlineLink> and <InlineLink href="https://blackskyweb.xyz">Blacksky</InlineLink> also host accounts.</Copy>
    </> : <>
      <AccountPicker value={handle} actors={preview ? [] : actors} disabled={busy} change={updateHandle}
        choose={actor => { updateHandle(actor.handle); setChosen(actor); }} submit={() => void submit()} />
      {preview && <View style={row}>
        {preview.avatar_url && <Image source={{ uri: preview.avatar_url }} style={{ width: 36, height: 36, borderRadius: 18 }} />}
        <Copy>{preview.display_name ? preview.display_name + ' · ' : ''}@{preview.handle}</Copy>
        {!busy && <Action label="not you?" onPress={() => updateHandle('')} />}
      </View>}
      <Copy>your @handle from <InlineLink href="https://bsky.app">Bluesky</InlineLink> or <InlineLink href="https://blackskyweb.xyz">Blacksky</InlineLink></Copy>
      {deviceOnly === 'true' && <Copy>preferences will stay on this device for this sign-in.</Copy>}
    </>}
    <Action primary label={busy ? (host ? 'taking you to ' + host + '…' : 'redirecting…') : creating ? 'create account' : host ? 'continue at ' + host : 'sign in'}
      onPress={() => void submit()} disabled={busy || (!creating && !identifier)} />
    <Copy>{busy && slow ? 'still connecting. some servers take a few seconds.' : 'you’ll come straight back here after. plyr.fm never sees your password.'}</Copy>
    <Copy>by continuing you agree to the <InlineLink href="https://plyr.fm/terms">terms</InlineLink> and <InlineLink href="https://plyr.fm/privacy">privacy policy</InlineLink>.</Copy>
    <Action label={creating ? 'what is a PDS?' : 'new to the atmosphere?'}
      selected={showHelp} onPress={() => setShowHelp(!showHelp)} />
    {showHelp && (creating ? <>
      <Copy>a Personal Data Server (PDS) is where your data lives on the <InlineLink href="https://atproto.com">AT Protocol</InlineLink> network. think of it as choosing a home for your account — you can always move later.</Copy>
      <Copy>learn more at <InlineLink href="https://atproto.com/guides/self-hosting">atproto.com</InlineLink>.</Copy>
    </> : <>
      <Copy>hey, welcome in! you'll need an account.</Copy>
      <Action label="create one here" disabled={busy} onPress={() => { setCreating(true); setShowHelp(false); }} />
      <Copy>or sign up with <InlineLink href="https://bsky.app">Bluesky</InlineLink> or <InlineLink href="https://blackskyweb.xyz">Blacksky</InlineLink> and come back.</Copy>
    </>)}
    {(error || (!creating && auth.error)) && <Copy>{error || auth.error}</Copy>}
    {!creating && (error || auth.scopeRejected) && <Action label="keep settings on this device" onPress={() => void submit(true)}
      disabled={busy || !identifier} />}
  </Page>;
}
