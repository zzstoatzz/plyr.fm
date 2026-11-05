import { useState } from 'react';
import { Switch, View } from 'react-native';
import { useAuth, logout } from '../src/auth';
import { useAppearance } from '../src/appearance';
import { Action, Copy, Field, Page, row } from '../src/controls';
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

  return <Page title="Settings">
    <Copy>Theme</Copy>
    <View style={row}>{themes.map((value) => <Action key={value} label={value} selected={preferences.theme === value} onPress={() => setPreferences({ theme: value })} />)}</View>
    <Copy>Interface size</Copy>
    <View style={row}>{[0.9, 1, 1.15, 1.3].map((value) => <Action key={value} label={`${Math.round(value * 100)}%`} selected={preferences.scale === value} onPress={() => setPreferences({ scale: value })} />)}</View>
    <Copy>Font</Copy>
    <View style={row}>{fonts.map((value) => <Action key={value} label={value === 'comic-sans' ? 'comic sans' : value} selected={preferences.font === value} onPress={() => setPreferences({ font: value })} />)}</View>
    <Copy>Accent color</Copy>
    <View style={row}>{accents.map((value) => <Action key={value} label={value} selected={preferences.accent === value} onPress={() => {
      setAccent(undefined);
      setPreferences({ accent: value });
    }} />)}</View>
    <Field label="Custom accent" value={accent ?? preferences.accent} onChangeText={setAccent} maxLength={7} />
    {accent !== undefined && <Action label="Apply accent" disabled={!/^#[0-9a-f]{6}$/i.test(accent)}
      onPress={() => { setPreferences({ accent }); setAccent(undefined); }} />}
    <View style={row}><Copy>Play through collections</Copy><Switch accessibilityLabel="Play through collections"
      value={preferences.playThrough} trackColor={{ true: theme.accent }} onValueChange={(playThrough) => setPreferences({ playThrough })} /></View>
    <View style={row}><Copy>Keep playing</Copy><Switch accessibilityLabel="Keep playing"
      value={preferences.keepPlaying} trackColor={{ true: theme.accent }} onValueChange={(keepPlaying) => setPreferences({ keepPlaying })} /></View>
    {auth.did ? <>
      <Copy>{status === 'synced' ? 'Preferences synced to your private Space.' : status === 'syncing' ? 'Syncing preferences…' : 'Preferences kept on this device.'}</Copy>
      {status === 'error' && <Action label="Retry sync" onPress={() => void sync()} />}
      {!auth.preferenceSpace && <Action label="Sign in again to enable sync" href="/login" />}
      <Action label="Sign out" onPress={() => void logout().catch(() => setError('Could not revoke this session.'))} />
    </> : <Action label="Sign in to sync preferences" href="/login" />}
    {error && <Copy>{error}</Copy>}
  </Page>;
}
