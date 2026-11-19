import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { ApiError, type Track } from '@plyr/next-core/api';
import { formatAudio } from '@plyr/next-core/downloads/format';
import { storeName } from '@plyr/next-core/selling';
import { ArrowLeft, DownloadSimple as Download } from '../icons';
import { api } from '../api-client';
import { ActionRow } from '../ActionRow';
import { useAppearance } from '../appearance';
import { Action, Copy } from '../controls';
import { Text } from '../Text';
import { artistName } from '../CatalogPieces';
import { downloadAllowed, prepareDownload } from './model';
import { saveDownload } from './delivery';
import { useAuth } from '../auth';
import { prepareProtectedDownload } from './protected';
import { downloadSession } from './session';
import { authorizeSupporterDownload, DownloadGrantRequired } from './supporter';

type Prepared = Awaited<ReturnType<typeof prepareDownload>>;

/**
 * One tap downloads. The menu turns into a download panel only when there is something to decide:
 * the artist asks for support, a lossless original exists, or the account needs a grant.
 */
export function DownloadAction({ track, reconnect, expanded, onExpand, done }: {
  track: Track; reconnect: () => void; expanded: boolean; onExpand: (expanded: boolean) => void; done: () => void;
}) {
  const auth = useAuth();
  const theme = useAppearance();
  const [busy, setBusy] = useState(false), [error, setError] = useState<string>();
  const [picked, setPicked] = useState<'playback' | 'original'>();
  const [choice, setChoice] = useState<Prepared>();
  const [needsGrant, setNeedsGrant] = useState(false);
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => { active.current?.abort(); }, [track.record.uri]);
  useEffect(() => {
    active.current?.abort(); active.current = null;
    setBusy(false); setChoice(undefined); setError(undefined); setNeedsGrant(false); onExpand(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only an account change resets the panel
  }, [auth.did, auth.rpc]);
  function expand(next: Prepared | undefined, grant = false) {
    setChoice(next); setNeedsGrant(grant); onExpand(!!next || grant);
  }
  async function download(selection?: 'playback' | 'original') {
    if (active.current) return;
    if (track.access.download_policy === 'supporters' && !auth.supporterDownloads) { expand(undefined, true); return; }
    const controller = new AbortController(); active.current = controller;
    setBusy(true); setError(undefined); setPicked(selection);
    try {
      const prepared = await prepareDownload(track.id, track.record.uri, {
        track: id => api.track(id, { fresh: true }), artist: api.artist,
        playback: id => api.playback(id, { fresh: true }).catch(failure => {
          if (failure instanceof ApiError && failure.status === 401) throw new Error('this track has no supported download source.');
          throw failure;
        }),
        authorize: record => authorizeSupporterDownload(auth, record, downloadSession(auth, controller.signal), controller.signal),
        protected: (current, uri, admission) => prepareProtectedDownload(current, uri, auth, controller.signal, admission)
      }, controller.signal);
      controller.signal.throwIfAborted();
      if (!selection && (prepared.support || prepared.buy || prepared.original)) { expand(prepared); return; }
      const selected = selection === 'original' ? prepared.original : prepared;
      if (!selected) throw new Error('the original file changed. choose again.');
      await saveDownload(selected, controller.signal);
      if (!controller.signal.aborted) done();
    } catch (failure) {
      if (controller.signal.aborted) return;
      if (failure instanceof DownloadGrantRequired) expand(undefined, true);
      else setError(failure instanceof Error ? failure.message : 'could not download this track. try again.');
    } finally {
      if (active.current === controller) { active.current = null; setBusy(false); setPicked(undefined); }
    }
  }
  if (!downloadAllowed(track)) return null;
  if (!expanded) return <View>
    <ActionRow icon={Download} label={busy ? 'preparing download…' : 'download'} disabled={busy} onPress={() => void download()} />
    {error && <Copy live>{error}</Copy>}
  </View>;
  const back = () => { active.current?.abort(); active.current = null; setBusy(false); setError(undefined); expand(undefined); };
  const artist = artistName(track);
  const option = (label: string, detail: string, selection: 'playback' | 'original', strong: boolean) =>
    <Pressable accessibilityRole="button" accessibilityLabel={`${label}, ${detail}`} disabled={busy} onPress={() => void download(selection)}
      style={({ pressed }) => ({ minHeight: 60, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12, borderWidth: 1,
        borderColor: strong ? theme.accent : theme.line, backgroundColor: pressed ? theme.hover : 'transparent', opacity: busy && picked !== selection ? 0.5 : 1 })}>
      <View style={{ flex: 1 }}>
        <Text style={{ color: theme.text, fontWeight: '600', fontSize: 16 * theme.scale }}>{label}</Text>
        <Text style={{ color: theme.faint, fontSize: 13 * theme.scale }}>{detail}</Text>
      </View>
      {picked === selection ? <ActivityIndicator color={theme.accent} /> : <Download size={20} color={strong ? theme.accent : theme.muted} />}
    </Pressable>;
  return <View style={{ gap: 10, paddingBottom: 6 }}>
    <ActionRow icon={ArrowLeft} label="back" onPress={back} />
    {needsGrant ? <>
      <Copy>{artist} keeps downloads for supporters. {auth.did ? 'reconnect so plyr.fm can check your support.' : 'sign in so plyr.fm can check your support.'}</Copy>
      <Action primary label={auth.did ? 'reconnect' : 'sign in'} disabled={!auth.ready} onPress={reconnect} />
    </> : choice && <>
      {(choice.buy || choice.support) && <>
        <Copy>{choice.buy ? `${artist} asks you to consider buying it if you can.` : `${artist} asks listeners to consider supporting their work.`}</Copy>
        {choice.buy && <Action primary label={`buy · ${choice.buy.label}`} href={choice.buy.url} />}
        {choice.support && <Action primary={!choice.buy} label={`support ${artist} on ${storeName(choice.support)}`} href={choice.support} />}
      </>}
      {choice.original
        ? <>{option('original upload', formatAudio(choice.original), 'original', true)}{option('smaller file', formatAudio(choice), 'playback', false)}</>
        : option('continue to download', formatAudio(choice), 'playback', true)}
    </>}
    {error && <Copy live>{error}</Copy>}
  </View>;
}
