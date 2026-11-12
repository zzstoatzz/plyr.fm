export type DownloadPreference = 'open' | 'ask' | 'off';

export function editableDownloadPreference(record: Record<string, unknown>, visibility: string): DownloadPreference | undefined {
  if (!['public', 'unlisted'].includes(visibility)
    || (record.visibility !== undefined && record.visibility !== 'public' && record.visibility !== 'unlisted')
    || ['audioSpace', 'audioFileId', 'originalAudioBlob', 'audioPayload', 'privateAudio', 'supportGate'].some(key => Object.hasOwn(record, key))) return undefined;
  const policy = record.downloadPolicy;
  if (policy === undefined) return 'open';
  return policy === 'open' || policy === 'ask' || policy === 'off' ? policy : undefined;
}

export function changedDownloadPreference(record: Record<string, unknown>, visibility: string, policy: DownloadPreference): Record<string, unknown> {
  if (!['open', 'ask', 'off'].includes(policy) || editableDownloadPreference(record, visibility) === undefined) {
    throw new Error('these download settings cannot be changed here.');
  }
  return { ...record, downloadPolicy: policy };
}
