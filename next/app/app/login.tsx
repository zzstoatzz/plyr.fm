import { Link, router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Image, Platform, View } from 'react-native';
import { createAccount, login, useAuth } from '../src/auth';
import { Action, Copy, Field, Page, row } from '../src/controls';
import { returnPath } from '../src/return-path';

const catalog = 'https://api.plyr.fm/auth';
const typeahead = 'https://typeahead.waow.tech/xrpc/app.bsky.actor.searchActorsTypeahead';

interface Actor { handle: string; displayName?: string; avatar?: string }
interface Preview { handle: string; display_name?: string; avatar_url?: string; sign_in_host: string }
interface Provider { url: string; name: string; recommended: boolean; description?: string; info_url?: string }

export default function Login() {
  const auth = useAuth();
  const { deviceOnly, return_to } = useLocalSearchParams<{ deviceOnly?: string; return_to?: string }>();
  const intent = returnPath(return_to);
  const [showHelp, setShowHelp] = useState(false);
  const [creating, setCreating] = useState(false);
  const [handle, setHandle] = useState('');
  const [actors, setActors] = useState<Actor[]>([]);
  const [preview, setPreview] = useState<Preview>();
  const [providers, setProviders] = useState<Provider[]>();
  const [provider, setProvider] = useState<Provider>();
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
        void fetch(catalog + '/sign-in-preview?handle=' + query, { signal })
          .then(async response => {
            if (!response.ok) return;
            const account: Preview = await response.json();
            if (!signal.aborted) { setPreview(account); setActors([]); }
          }).catch(() => {});
      }
      if (!identifier.startsWith('did:')) {
        void fetch(typeahead + '?q=' + query + '&limit=5', { signal, headers: { 'X-Client': 'next.plyr.fm' } })
          .then(async response => {
            if (!response.ok) return;
            const result: { actors?: Actor[] } = await response.json();
            if (!signal.aborted) setActors(result.actors ?? []);
          }).catch(() => {});
      }
    }, 300);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [identifier, creating, busy]);

  useEffect(() => {
    if (!creating) return;
    const controller = new AbortController();
    void fetch(catalog + '/pds-options', { signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error();
        const data: { enabled: boolean; options: Provider[] } = await response.json();
        if (controller.signal.aborted) return;
        const options = data.enabled ? data.options.filter(item => item.url.startsWith('https://')) : [];
        setProviders(options);
        setProvider(options.find(item => item.recommended) ?? options[0]);
      }).catch(() => { if (!controller.signal.aborted) setProviders([]); });
    return () => controller.abort();
  }, [creating]);

  useEffect(() => {
    if (!busy) return;
    const timer = setTimeout(() => setSlow(true), 4000);
    return () => clearTimeout(timer);
  }, [busy]);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    function reset(event: PageTransitionEvent) {
      if (!event.persisted) return;
      pending.current = false;
      setBusy(false);
      setSlow(false);
    }
    window.addEventListener('pageshow', reset);
    return () => window.removeEventListener('pageshow', reset);
  }, []);

  function updateHandle(value: string) {
    setHandle(value);
    setPreview(undefined);
    setActors([]);
    setError(undefined);
  }

  async function submit(localOnly = deviceOnly === 'true') {
    if (pending.current || (creating ? !provider : !identifier)) return;
    pending.current = true;
    setBusy(true);
    setSlow(false);
    setError(undefined);
    try {
      const destination = typeof intent === 'string' ? intent : undefined;
      if (creating && provider) await createAccount(provider.url, destination);
      else await login(identifier, localOnly, destination);
      router.replace(intent ?? '/settings');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not continue. Please try again.');
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  const host = creating ? provider?.name : preview?.sign_in_host;
  return <Page title={creating ? 'create account' : 'sign in to plyr.fm'}>
    <View style={row}>
      <Action label="sign in" selected={!creating} disabled={busy} onPress={() => { setCreating(false); setShowHelp(false); setError(undefined); }} />
      <Action label="create account" selected={creating} disabled={busy} onPress={() => { setCreating(true); setShowHelp(false); setError(undefined); }} />
    </View>
    {creating ? <>
      <Copy>choose a <Link href="https://at-me.zzstoatzz.io/view/?handle=zzstoatzz.io">home</Link> for your data</Copy>
      {providers === undefined && <Copy>loading account providers…</Copy>}
      {providers?.length === 0 && <Copy>account providers are unavailable right now. you can still create an account with Bluesky or Blacksky.</Copy>}
      {providers?.map(item => <View key={item.url} style={{ gap: 6 }}>
        <Action label={item.name + (item.recommended ? ' · recommended' : '')} selected={item.url === provider?.url}
          disabled={busy} onPress={() => setProvider(item)} />
        {item.description && <Copy>{item.info_url ? <Link href={item.info_url}>{item.description}</Link> : item.description}</Copy>}
      </View>)}
      <Copy><Link href="https://bsky.app">Bluesky</Link> and <Link href="https://blackskyweb.xyz">Blacksky</Link> also host accounts.</Copy>
    </> : <>
      <Field label="atmosphere account" value={handle} onChangeText={updateHandle} autoCapitalize="none" autoCorrect={false}
        editable={!busy} placeholder="you.example.com" onSubmitEditing={() => void submit()} />
      {!preview && !busy && actors.map(actor => <Action key={actor.handle} label={actor.displayName ? actor.displayName + ' · @' + actor.handle : '@' + actor.handle}
        onPress={() => updateHandle(actor.handle)} />)}
      {preview && <View style={row}>
        {preview.avatar_url && <Image source={{ uri: preview.avatar_url }} style={{ width: 36, height: 36, borderRadius: 18 }} />}
        <Copy>{preview.display_name ? preview.display_name + ' · ' : ''}@{preview.handle}</Copy>
        {!busy && <Action label="not you?" onPress={() => updateHandle('')} />}
      </View>}
      <Copy>your @handle from <Link href="https://bsky.app">Bluesky</Link> or <Link href="https://blackskyweb.xyz">Blacksky</Link></Copy>
      {deviceOnly === 'true' && <Copy>Preferences will stay on this device for this sign-in.</Copy>}
    </>}
    <Action primary label={busy ? (host ? 'taking you to ' + host + '…' : 'redirecting…') : creating ? 'create account' : host ? 'continue at ' + host : 'sign in'}
      onPress={() => void submit()} disabled={busy || (creating ? !provider : !identifier)} />
    <Copy>{busy && slow ? 'still connecting. some servers take a few seconds.' : 'you’ll come straight back here after. plyr.fm never sees your password.'}</Copy>
    <Action label={creating ? 'what is a PDS?' : 'new to the atmosphere?'}
      selected={showHelp} onPress={() => setShowHelp(!showHelp)} />
    {showHelp && (creating ? <>
      <Copy>a Personal Data Server (PDS) is where your data lives on the <Link href="https://atproto.com">AT Protocol</Link> network. think of it as choosing a home for your account — you can always move later.</Copy>
      <Copy>learn more at <Link href="https://atproto.com/guides/self-hosting">atproto.com</Link>.</Copy>
    </> : <>
      <Copy>hey, welcome in! you'll need an account.</Copy>
      <Action label="create one here" disabled={busy} onPress={() => { setCreating(true); setShowHelp(false); }} />
      <Copy>or sign up with <Link href="https://bsky.app">Bluesky</Link> or <Link href="https://blackskyweb.xyz">Blacksky</Link> and come back.</Copy>
    </>)}
    {(error || (!creating && auth.error)) && <Copy>{error || auth.error}</Copy>}
    {!creating && (error || auth.scopeRejected) && <Action label="sign in without preference sync" onPress={() => void submit(true)}
      disabled={busy || !identifier} />}
  </Page>;
}
