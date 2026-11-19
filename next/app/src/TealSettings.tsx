import { useState } from 'react';
import { Switch } from 'react-native';
import { useAppearance } from './appearance';
import { authorizeScrobbling, canScrobble, useAuth } from './auth';
import { Copy } from './controls';
import { Plugs } from './icons';
import { useAppPreferences } from './preference-context';
import { SettingsRow, SettingsSection } from './SettingsPieces';

export function TealSettings() {
  const { did } = useAuth();
  const theme = useAppearance();
  const { preferences, setPreferences } = useAppPreferences();
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState(false);
  const granted = canScrobble();

  async function toggle(enabled: boolean) {
    setError(false);
    if (!enabled) {
      setPreferences({ tealScrobbling: false });
      return;
    }
    setConnecting(true);
    try {
      await authorizeScrobbling();
      setPreferences({ tealScrobbling: true });
    } catch {
      setError(true);
    } finally {
      setConnecting(false);
    }
  }

  return <>
    <SettingsSection title="integrations" icon={Plugs}>
      {did ? <><SettingsRow label="teal.fm scrobbling" detail={connecting ? 'connecting to teal.fm…'
        : preferences.tealScrobbling && !granted ? 'reconnect to log listens from this device.'
          : 'log listens and show what you’re playing on teal.fm. public tracks only.'}>
        <Switch accessibilityLabel="teal.fm scrobbling" disabled={connecting} value={preferences.tealScrobbling}
          thumbColor={theme.background} trackColor={{ false: theme.border, true: theme.accent }}
          ios_backgroundColor={theme.border} onValueChange={value => void toggle(value)} />
      </SettingsRow>
      {preferences.tealScrobbling && !granted && !connecting && <SettingsRow label="reconnect teal.fm" onPress={() => void toggle(true)} />}</>
      : <SettingsRow label="teal.fm scrobbling" detail="sign in to connect teal.fm" href={{ pathname: '/login', params: { return_to: '/settings' } }} />}
    </SettingsSection>
    {error && <Copy live>couldn’t connect teal.fm. try again.</Copy>}
  </>;
}
