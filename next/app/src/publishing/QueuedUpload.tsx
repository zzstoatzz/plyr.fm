import { useState } from 'react';
import type { QueuedUploadDraft } from '@plyr/next-core/publishing/queued-upload-draft';
import { canonicalAudioType } from '@plyr/next-core/publishing/upload-queue-model';
import { Action, Copy } from '../controls';
import { pickMedia, retype } from '../media-picker';
import type { MediaFile } from '../pds';
import { pickArtwork } from './artwork';
import { queuedDrafts } from './upload-storage';
import { uploadQueue } from './upload-queue';

export function QueuedUpload({ draft, refresh }: { draft: QueuedUploadDraft; refresh: () => Promise<void> }) {
  const [audio, setAudio] = useState<MediaFile>();
  const [cover, setCover] = useState<MediaFile>();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');

  async function choose(kind: 'audio' | 'cover') {
    setBusy(true);
    setProblem('');
    try {
      if (kind === 'cover') {
        const file = await pickArtwork();
        if (file) setCover(file);
      } else {
        const file = await pickMedia('audio/*');
        if (file) setAudio(retype(file, canonicalAudioType(file)));
      }
    } catch (failure) {
      setProblem(failure instanceof Error ? failure.message : 'could not open the file.');
    } finally { setBusy(false); }
  }

  function resume() {
    if (!audio) return;
    try { uploadQueue.reattach(draft, audio, cover); }
    catch (failure) { setProblem(failure instanceof Error ? failure.message : 'could not resume the upload.'); }
  }

  async function discard() {
    setBusy(true);
    setProblem('');
    try { await queuedDrafts.take(draft); await refresh(); }
    catch { setProblem('could not discard the queued draft. try again.'); }
    finally { setBusy(false); }
  }

  return <>
    <Copy>{draft.title}</Copy>
    <Copy>choose {draft.audio.name} to resume this upload.</Copy>
    <Action label={audio?.name ?? 'Choose audio again'} disabled={busy} onPress={() => void choose('audio')} />
    {!!draft.coverName && <Action label={cover?.name ?? 'Choose cover again'} disabled={busy} onPress={() => void choose('cover')} />}
    {!!problem && <Copy live>{problem}</Copy>}
    <Action label="Resume queued upload" disabled={busy || !audio || (!!draft.coverName && !cover)} onPress={resume} />
    <Action label="Discard queued draft" disabled={busy} onPress={() => void discard()} />
  </>;
}
