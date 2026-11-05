import { useState } from 'react';
import { Platform, Pressable, Switch, View } from 'react-native';
import { router } from 'expo-router';
import Check from 'lucide-react-native/icons/check';
import Palette from 'lucide-react-native/icons/palette';
import Headphones from 'lucide-react-native/icons/headphones';
import UserRound from 'lucide-react-native/icons/user-round';
import { useAuth, logout } from '../src/auth';
import { useAppearance } from '../src/appearance';
import { Action, Copy, Field, Page, row } from '../src/controls';
import { Choice } from '../src/AccountPieces';
import { SettingsSection, SettingsRow } from '../src/SettingsPieces';
import { Sheet } from '../src/Sheet';
import { useAppPreferences } from '../src/preference-context';

const themes = ['system', 'light', 'dark'] as const;
const fonts = ['comic-sans', 'system', 'mono', 'serif'] as const;
const accents = [['blue', '#6a9fff'], ['green', '#4ade80'], ['pink', '#f472b6'], ['yellow', '#fbbf24'], ['purple', '#a78bfa'], ['rose', '#fb7185'], ['teal', '#2dd4bf'], ['orange', '#f97316']] as const;
const names = { theme: 'theme', font: 'font', scale: 'interface size', accent: 'accent color' };
type Picker = keyof typeof names;

export default function Settings() {
  const auth = useAuth();
  const { preferences, setPreferences, status, sync } = useAppPreferences();
  const theme = useAppearance();
  const [picker, setPicker] = useState<Picker>();
  const [accent, setAccent] = useState<string>();
  const [error, setError] = useState<string>();
  const login = { pathname: '/login', params: { return_to: '/settings' } } as const;
  const fontName = preferences.font === 'comic-sans' ? 'comic sans' : preferences.font;
  return <Page title="settings">
    <SettingsSection title="appearance" icon={Palette}>
      <SettingsRow label="theme" value={preferences.theme} onPress={() => setPicker('theme')} />
      <SettingsRow label="font" value={fontName} onPress={() => setPicker('font')} />
      <SettingsRow label="interface size" value={`${Math.round(preferences.scale * 100)}%`} onPress={() => setPicker('scale')} />
      <SettingsRow label="accent color" value={accents.find(([, hex]) => hex === preferences.accent)?.[0] ?? preferences.accent} onPress={() => { setAccent(undefined); setPicker('accent'); }}>
        <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: preferences.accent }} />
      </SettingsRow>
    </SettingsSection>
    <SettingsSection title="playback" icon={Headphones}>
      {([
        ['play through collections', 'when you play a track in an album or playlist, keep playing the rest of it', 'playThrough'],
        ['keep playing', 'when your queue runs out, keep playing from the catalog', 'keepPlaying']
      ] as const).map(([label, detail, key]) => <SettingsRow key={key} label={label} detail={detail}>
        <Switch {...(Platform.OS === 'web' ? { activeThumbColor: theme.background } : {})} accessibilityLabel={label} value={preferences[key]} thumbColor={theme.background} trackColor={{ false: theme.border, true: theme.accent }} ios_backgroundColor={theme.border} onValueChange={value => setPreferences({ [key]: value })} />
      </SettingsRow>)}
    </SettingsSection>
    <SettingsSection title="account" icon={UserRound}>
      {auth.did ? <>
        <SettingsRow label={auth.handle ? `@${auth.handle}` : auth.did} detail={status === 'synced' ? 'Preferences synced.' : status === 'syncing' ? 'Syncing preferences…' : 'Preferences kept on this device.'} />
        <SettingsRow label="creator portal" onPress={() => router.navigate('/portal')} />
        {status === 'error' && <SettingsRow label="retry sync" onPress={() => void sync()} />}
        {!auth.preferenceSpace && <SettingsRow label="sign in again to enable sync" onPress={() => router.navigate(login)} />}
        <SettingsRow label="sign out" destructive onPress={() => void logout().catch(() => setError('Could not revoke this session.'))} />
      </> : <SettingsRow label="sign in" detail="Sign in to sync preferences across your devices." onPress={() => router.navigate(login)} />}
    </SettingsSection>
    {error && <Copy live>{error}</Copy>}
    {picker && <Sheet title={names[picker]} close={() => setPicker(undefined)}>
      {picker === 'theme' && themes.map(value => <Choice key={value} label={value} selected={preferences.theme === value} onPress={() => { setPreferences({ theme: value }); setPicker(undefined); }} />)}
      {picker === 'font' && fonts.map(value => <Choice key={value} label={value === 'comic-sans' ? 'comic sans' : value} selected={preferences.font === value} onPress={() => { setPreferences({ font: value }); setPicker(undefined); }} />)}
      {picker === 'scale' && [0.9, 1, 1.15, 1.3].map(value => <Choice key={value} label={`${Math.round(value * 100)}%`} selected={preferences.scale === value} onPress={() => { setPreferences({ scale: value }); setPicker(undefined); }} />)}
      {picker === 'accent' && <>
        <View style={row}>{accents.map(([name, value]) => <Pressable key={value} accessibilityRole="button" accessibilityLabel={`Accent ${name}`} aria-pressed={preferences.accent === value}
          accessibilityState={{ selected: preferences.accent === value }} onPress={() => { setPreferences({ accent: value }); setPicker(undefined); }}
          style={{ width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: preferences.accent === value ? theme.text : 'transparent' }}>
          <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: value, alignItems: 'center', justifyContent: 'center' }}>{preferences.accent === value && <Check color="#10131a" size={18} />}</View>
        </Pressable>)}</View>
        <Field label="custom accent" value={accent ?? preferences.accent} onChangeText={setAccent} maxLength={7} autoCapitalize="none" autoCorrect={false} />
        <Action label="apply accent" disabled={!accent || !/^#[0-9a-f]{6}$/i.test(accent)} onPress={() => { if (accent) { setPreferences({ accent }); setPicker(undefined); } }} />
      </>}
    </Sheet>}
  </Page>;
}
