import { DarkTheme, DefaultTheme, Tabs, ThemeProvider } from 'expo-router';
import { NativeTabs } from 'expo-router/native-tabs';
import { useAppearance } from '../../src/appearance';
import { useAuth } from '../../src/auth';
import { useMyAvatar } from '../../src/use-my-avatar';
import { useTrackPlaybackState } from '../../src/playback-context';
import { PlayerBar } from '../../src/PlayerBar';
import { RadioPlayback, useRadio } from '../../src/radio-session';
import { usesLiquidTabs } from '../../src/tab-platform';

export default function MainLayout() {
  if (!usesLiquidTabs) return <Tabs backBehavior="history" tabBar={() => null} screenOptions={{ headerShown: false }} />;
  return <LiquidTabs />;
}

function LiquidTabs() {
  const theme = useAppearance();
  const { did } = useAuth();
  const avatar = useMyAvatar(did);
  const { current } = useTrackPlaybackState();
  const radio = useRadio();
  const base = theme.dark ? DarkTheme : DefaultTheme;
  const contentStyle = { backgroundColor: theme.background };
  const hasPlayer = !!current || !!(radio.station && radio.song && radio.snapshot);
  return <ThemeProvider value={{ ...base, colors: { ...base.colors, ...contentStyle } }}>
    <NativeTabs backBehavior="history" minimizeBehavior="never" tintColor={theme.accent}>
      {hasPlayer && <NativeTabs.BottomAccessory><LiquidPlayerAccessory /></NativeTabs.BottomAccessory>}
      <NativeTabs.Trigger name="(home)" contentStyle={contentStyle}>
        <NativeTabs.Trigger.Icon sf={{ default: 'house', selected: 'house.fill' }} />
        <NativeTabs.Trigger.Label>home</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="(search)" contentStyle={contentStyle}>
        <NativeTabs.Trigger.Icon sf="magnifyingglass" />
        <NativeTabs.Trigger.Label>search</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="(library)" contentStyle={contentStyle}>
        <NativeTabs.Trigger.Icon sf="books.vertical" />
        <NativeTabs.Trigger.Label>library</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="(publish)" hidden={!did} contentStyle={contentStyle}>
        <NativeTabs.Trigger.Icon sf="plus.circle" />
        <NativeTabs.Trigger.Label>upload</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="(you)" contentStyle={contentStyle}>
        {avatar && did ? <NativeTabs.Trigger.Icon src={{ uri: avatar }} renderingMode="original" />
          : <NativeTabs.Trigger.Icon sf={did ? 'person.crop.circle' : 'person.crop.circle.badge.plus'} />}
        <NativeTabs.Trigger.Label>{did ? 'you' : 'sign in'}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  </ThemeProvider>;
}

function LiquidPlayerAccessory() {
  const placement = NativeTabs.BottomAccessory.usePlacement();
  return placement === 'regular' ? <RadioPlayback><PlayerBar accessory /></RadioPlayback> : null;
}
