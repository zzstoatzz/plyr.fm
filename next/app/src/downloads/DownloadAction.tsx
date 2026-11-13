import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import Download from 'lucide-react-native/icons/download';
import { api, ApiError, type Track } from '../api';
import { ActionRow } from '../ActionRow';
import { Action, Copy, row } from '../controls';
import { downloadAllowed, prepareDownload } from './model';
import { saveDownload } from './delivery';
import { useAuth } from '../auth';
import { prepareProtectedDownload } from './protected';
import { downloadSession } from './session';
import { authorizeSupporterDownload, DownloadGrantRequired } from './supporter';

function formatAudio(audio: { mime: string; sizeBytes?: number }): string {
  const type = audio.mime.replace(/^audio\//, '').toUpperCase();
  if (!audio.sizeBytes) return type;
  const unit = audio.sizeBytes >= 1_048_576 ? 'MiB' : 'KiB';
  const size = audio.sizeBytes / (unit === 'MiB' ? 1_048_576 : 1024);
  return `${type} · ${size.toLocaleString(undefined, { maximumFractionDigits: 1 })} ${unit}`;
}

export function DownloadAction({ track, reconnect }: { track: Track; reconnect: () => void }) {
  const auth = useAuth();
  const [busy, setBusy] = useState(false), [message, setMessage] = useState<string>();
  const [choice, setChoice] = useState<Awaited<ReturnType<typeof prepareDownload>>>();
  const [needsGrant, setNeedsGrant] = useState(false);
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => { active.current?.abort(); }, [track.record.uri]);
  useEffect(() => {
    active.current?.abort(); active.current = null;
    setBusy(false); setChoice(undefined); setMessage(undefined); setNeedsGrant(false);
  }, [auth.did, auth.rpc]);
  async function download(selection?: 'playback' | 'original') {
    if (active.current) return;
    const controller = new AbortController(); active.current = controller;
    setBusy(true); setMessage(undefined);
    try {
      const prepared = await prepareDownload(track.id, track.record.uri, {
        track: id => api.track(id, { fresh: true }), artist: api.artist,
        playback: id => api.playback(id, { fresh: true }).catch(error => {
          if (error instanceof ApiError && error.status === 401) throw new Error('this track has no supported download source.');
          throw error;
        }),
        authorize: record => authorizeSupporterDownload(auth, record, downloadSession(auth, controller.signal), controller.signal),
        protected: (current, uri, admission) => prepareProtectedDownload(current, uri, auth, controller.signal, admission)
      }, controller.signal);
      controller.signal.throwIfAborted();
      if (!selection && (prepared.support || prepared.original)) { setChoice(prepared); return; }
      if (selection === 'original' && !prepared.original) throw new Error('the original download changed. choose a download again.');
      const selected = selection === 'original' ? prepared.original : prepared;
      if (!selected) throw new Error('the original download is unavailable.');
      setChoice(undefined);
      await saveDownload(selected, controller.signal);
      if (!controller.signal.aborted) setMessage('download opened.');
    } catch (error) {
      if (!controller.signal.aborted) { setChoice(undefined); setNeedsGrant(error instanceof DownloadGrantRequired); setMessage(error instanceof Error ? error.message : 'could not download audio. try again.'); }
    } finally {
      if (active.current === controller) active.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  if (!downloadAllowed(track)) return null;
  if (needsGrant || (track.access.download_policy === 'supporters' && !auth.supporterDownloads)) return <View style={{ gap: 10, paddingVertical: 10 }}>
    <Copy>{auth.did ? 'reconnect to allow supporter download checks.' : 'sign in to check access to this download.'}</Copy>
    <Action label={auth.did ? 'Reconnect for supporter downloads' : 'Sign in for supporter downloads'} disabled={!auth.ready} onPress={reconnect} />
  </View>;
  return <View style={{ gap: choice || message || busy ? 10 : 0 }}>
    <ActionRow icon={Download} label={busy ? 'preparing download…' : 'download audio'} disabled={busy} onPress={() => void download()} />
    {choice && <>
      {choice.support && <><Copy>consider supporting this artist before downloading. support is optional.</Copy><Action label="Support artist" href={choice.support} /></>}
      {choice.original ? <>
        <Copy>choose the listening version or the original uploaded file.</Copy>
        <Action label={`Playback audio · ${formatAudio(choice)}`} disabled={busy} onPress={() => void download('playback')} />
        <Action label={`Original upload · ${formatAudio(choice.original)}`} primary disabled={busy} onPress={() => void download('original')} />
      </> : <Action label="Continue download" primary disabled={busy} onPress={() => void download('playback')} />}
      {!busy && <View style={row}><Action label="Cancel download" onPress={() => setChoice(undefined)} /></View>}
    </>}
    {busy && <Action label="Cancel download" onPress={() => { active.current?.abort(); active.current = null; setBusy(false); setChoice(undefined); setMessage(undefined); }} />}
    {message && <Copy live>{message}</Copy>}
  </View>;
}
