import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { login, useAuth } from '../src/auth';
import { Action, Copy, Field, Page } from '../src/controls';

export default function Login() {
  const auth = useAuth();
  const { deviceOnly } = useLocalSearchParams<{ deviceOnly?: string }>();
  const [handle, setHandle] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function submit(localOnly = deviceOnly === 'true') {
    if (busy || !handle.trim()) return;
    setBusy(true);
    setError(undefined);
    try {
      await login(handle, localOnly);
      router.replace('/settings');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Sign in failed.');
    } finally {
      setBusy(false);
    }
  }

  return <Page title="Sign in">
    <Copy>Use your AT Protocol handle. Writes go directly to your PDS.</Copy>
    {deviceOnly === 'true' && <Copy>Preferences will stay on this device for this sign-in.</Copy>}
    <Field label="Handle" value={handle} onChangeText={setHandle} autoCapitalize="none" autoCorrect={false}
      placeholder="you.bsky.social" onSubmitEditing={() => void submit()} />
    <Action label={busy ? 'Signing in…' : 'Continue'} onPress={() => void submit()} disabled={busy || !handle.trim()} />
    {(error || auth.error) && <Copy>{error || auth.error}</Copy>}
    {(error || auth.scopeRejected) && <Action label="Sign in without preference sync" onPress={() => void submit(true)}
      disabled={busy || !handle.trim()} />}
  </Page>;
}
