import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import Download from 'lucide-react-native/icons/download';
import { api, type Track } from '../api';
import { ActionRow } from '../ActionRow';
import { Action, Copy, row } from '../controls';
import { downloadAllowed, prepareDownload } from './model';
import { saveDownload } from './delivery';

export function DownloadAction({ track }: { track: Track }) {
  const [busy, setBusy] = useState(false), [message, setMessage] = useState<string>();
  const [support, setSupport] = useState<string>();
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => { active.current?.abort(); }, [track.record.uri]);
  async function download(accepted = false) {
    if (active.current) return;
    const controller = new AbortController(); active.current = controller;
    setBusy(true); setMessage(undefined);
    try {
      const prepared = await prepareDownload(track.id, track.record.uri, {
        track: id => api.track(id, { fresh: true }), playback: id => api.playback(id, { fresh: true }), artist: api.artist
      });
      controller.signal.throwIfAborted();
      if (prepared.support && !accepted) { setSupport(prepared.support); return; }
      setSupport(undefined);
      await saveDownload(prepared, controller.signal);
      if (!controller.signal.aborted) setMessage('download opened.');
    } catch (error) {
      if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : 'could not download audio. try again.');
    } finally {
      if (active.current === controller) active.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  if (!downloadAllowed(track)) return null;
  return <View style={{ gap: support || message || busy ? 10 : 0 }}>
    <ActionRow icon={Download} label={busy ? 'preparing download…' : 'download audio'} disabled={busy} onPress={() => void download()} />
    {support && <>
      <Copy>consider supporting this artist before downloading. support is optional.</Copy>
      <View style={row}><Action label="Support artist" href={support} /><Action label="Continue download" primary disabled={busy} onPress={() => void download(true)} />{!busy && <Action label="Cancel download" onPress={() => setSupport(undefined)} />}</View>
    </>}
    {busy && <Action label="Cancel download" onPress={() => { active.current?.abort(); active.current = null; setBusy(false); setMessage(undefined); }} />}
    {message && <Copy live>{message}</Copy>}
  </View>;
}
