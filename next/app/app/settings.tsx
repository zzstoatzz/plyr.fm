import { useState } from 'react';
import { Pressable, Switch, View } from 'react-native';
import Check from 'lucide-react-native/icons/check';
import { useAuth, logout } from '../src/auth';
import { useAppearance } from '../src/appearance';
import { Action, Copy, Field, Page, row } from '../src/controls';
import { AccountSection, Choice, Setting } from '../src/AccountPieces';
import { Text } from '../src/Text';
import { useAppPreferences } from '../src/preference-context';

const themes = ['system', 'light', 'dark'] as const;
const fonts = ['comic-sans', 'system', 'mono', 'serif'] as const;
const accents = ['#6a9fff', '#4ade80', '#f472b6', '#fbbf24', '#a78bfa', '#fb7185', '#2dd4bf', '#f97316'];

export default function Settings() {
  const auth = useAuth();
  const { preferences, setPreferences, status, sync } = useAppPreferences();
  const theme = useAppearance();
  const [accent, setAccent] = useState<string>();
  const [error, setError] = useState<string>();
  const login = { pathname: '/login', params: { return_to: '/settings' } } as const;
  return <Page title="settings">
    <AccountSection title="appearance">
      <Setting label="theme"><View style={row}>{themes.map(value => <Choice key={value} label={value} selected={preferences.theme === value} onPress={() => setPreferences({ theme: value })} />)}</View></Setting>
      <Setting label="font"><View style={row}>{fonts.map(value => <Choice key={value} label={value === 'comic-sans' ? 'comic sans' : value} selected={preferences.font === value} onPress={() => setPreferences({ font: value })} />)}</View></Setting>
      <Setting label="interface size"><View style={row}>{[0.9, 1, 1.15, 1.3].map(value => <Choice key={value} label={`${Math.round(value * 100)}%`} selected={preferences.scale === value} onPress={() => setPreferences({ scale: value })} />)}</View></Setting>
      <Setting label="accent color">
        <View style={row}>{accents.map(value => <Pressable key={value} accessibilityRole="button" accessibilityLabel={`Accent ${value}`}
          accessibilityState={{ selected: preferences.accent === value }} onPress={() => { setAccent(undefined); setPreferences({ accent: value }); }}
          style={{ width: 44, height: 44, borderRadius: 22, borderWidth: 1, borderColor: preferences.accent === value ? theme.text : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
          <View style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: value, alignItems: 'center', justifyContent: 'center' }}>
            {preferences.accent === value && <Check color="#10131a" size={18} />}
          </View>
        </Pressable>)}</View>
        <View style={{ maxWidth: 320, gap: 8 }}>
          <Field label="custom accent" value={accent ?? preferences.accent} onChangeText={setAccent} maxLength={7} autoCapitalize="none" autoCorrect={false} />
          {accent !== undefined && <Action label="apply accent" disabled={!/^#[0-9a-f]{6}$/i.test(accent)} onPress={() => { setPreferences({ accent }); setAccent(undefined); }} />}
        </View>
      </Setting>
    </AccountSection>
    <AccountSection title="playback">
      {([
        ['play through collections', 'playThrough'], ['keep playing', 'keepPlaying']
      ] as const).map(([label, key]) => <View key={key} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 16, minHeight: 48 }}>
        <Text style={{ flex: 1, color: theme.text, fontSize: 15 * theme.scale }}>{label}</Text>
        <Switch accessibilityLabel={label} value={preferences[key]} trackColor={{ true: theme.accent }} onValueChange={value => setPreferences({ [key]: value })} />
      </View>)}
    </AccountSection>
    <AccountSection title="account">
      {auth.did ? <>
        <Copy>{auth.handle ? `@${auth.handle}` : auth.did}</Copy>
        <Copy>{status === 'synced' ? 'Preferences synced.' : status === 'syncing' ? 'Syncing preferences…' : 'Preferences kept on this device.'}</Copy>
        <View style={row}>
          <Action label="creator portal" href="/portal" />
          {status === 'error' && <Action label="retry sync" onPress={() => void sync()} />}
          {!auth.preferenceSpace && <Action label="sign in again to enable sync" href={login} />}
          <Action label="sign out" onPress={() => void logout().catch(() => setError('Could not revoke this session.'))} />
        </View>
      </> : <><Copy>Sign in to sync preferences across your devices.</Copy><View style={row}><Action label="sign in" href={login} /></View></>}
      {error && <Copy>{error}</Copy>}
    </AccountSection>
  </Page>;
}
