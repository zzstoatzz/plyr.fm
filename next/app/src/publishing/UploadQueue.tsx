import { useEffect } from 'react';
import { View } from 'react-native';
import { useAuth } from '../auth';
import { trackIdFromUri } from '../api';
import { Action, Copy } from '../controls';
import { guardLeave } from './leave-guard';
import { jobLine } from './upload-queue-model';
import { uploadQueue, useUploadQueue } from './upload-queue';

/** Mounted once at the root: resumes saved uploads for the signed-in account and guards the tab while one runs. */
export function UploadQueueHost() {
  const auth = useAuth();
  useEffect(() => guardLeave(uploadQueue.active), []);
  useEffect(() => { if (auth.did && auth.uploadStorage) void uploadQueue.resume(auth.did).catch(() => undefined); }, [auth.did, auth.uploadStorage]);
  return null;
}

export function UploadQueueList({ onEdit }: { onEdit?: (id: string) => void }) {
  const did = useAuth().did;
  const jobs = useUploadQueue().filter(job => job.owner === did);
  if (!jobs.length) return null;
  return <>
    {jobs.map(job => <View key={job.id} style={{ gap: 6 }}>
      <Copy live>{jobLine(job)}</Copy>
      {onEdit && uploadQueue.editable(job.id) && <Action label="Put back in the form" onPress={() => onEdit(job.id)} />}
    </View>)}
    {jobs.filter(job => job.phase === 'done' && job.uri).slice(-1).map(job =>
      <Action key={job.id} label="View track" href={`/track/${trackIdFromUri(job.uri!)}`} />)}
  </>;
}
