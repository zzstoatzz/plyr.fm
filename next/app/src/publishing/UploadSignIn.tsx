import { Action, Copy } from '../controls';
import { usePendingSharedAudio } from './shared-audio';

export function UploadSignIn({ onlyYou }: { onlyYou: boolean }) {
  const shared = usePendingSharedAudio();
  return <>
    {shared && <Copy>sign in to upload {shared}.</Copy>}
    <Action label="Sign in" href={{ pathname: '/login', params: { return_to: onlyYou ? '/upload?visibility=only-you' : '/upload' } }} />
  </>;
}
