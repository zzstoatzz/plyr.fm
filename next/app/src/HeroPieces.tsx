import { Link, type Href } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { Image, PixelRatio, Pressable, StyleSheet, View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { displayUrl } from '@plyr/next-core/artwork';
import { useAppearance } from './appearance';
import { Text } from './Text';

/** The page column pads 20 on each side and 16 on top; a hero bleeds past that. */
export const BLEED = 20;
export const TOP = 16;
const CONTROL = 48;

export function shuffled<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/** Blurred artwork behind a hero, fading into the page at the top and bottom. */
export function HeroBackdrop({ uri, height }: { uri: string; height: number }) {
  const theme = useAppearance();
  return <View aria-hidden pointerEvents="none" style={[styles.backdrop, { height }]}>
    <Backdrop key={uri} uri={uri} opacity={theme.dark ? 0.6 : 0.7} />
    {/* 100% so the fade covers a backdrop wider than the window (the queue's bleeds past the page padding) */}
    <Svg style={StyleSheet.absoluteFill} width="100%" height={height}>
      <Defs><LinearGradient id="hero-fade" x1="0" y1="0" x2="0" y2="1">
        <Stop offset={0} stopColor={theme.background} stopOpacity={1} />
        <Stop offset={0.28} stopColor={theme.background} stopOpacity={0} />
        <Stop offset={0.72} stopColor={theme.background} stopOpacity={0.8} />
        <Stop offset={1} stopColor={theme.background} stopOpacity={1} />
      </LinearGradient></Defs>
      <Rect width="100%" height="100%" fill="url(#hero-fade)" />
    </Svg>
  </View>;
}

/** A small rendition is plenty under a heavy blur; the original is the fallback. */
function Backdrop({ uri, opacity }: { uri: string; opacity: number }) {
  // iOS can't blur bsky's transparent WebP avatars (the blur fails silently), so ask its CDN for a JPEG.
  const opaque = /^https:\/\/cdn\.bsky\.app\//.test(uri) ? uri.replace(/@(webp|png|jpeg)$/i, '') + '@jpeg' : null;
  const sources = [...new Set([opaque ?? displayUrl(uri, 160, PixelRatio.get()), uri])];
  const [index, setIndex] = useState(0);
  if (index >= sources.length) return null;
  return <Image aria-hidden source={{ uri: sources[index] }} blurRadius={40} resizeMode="cover" onError={() => setIndex(index + 1)}
    style={[StyleSheet.absoluteFill, { opacity, transform: [{ scale: 1.3 }] }]} />;
}

export function Chip({ value, label }: { value: string; label?: string }) {
  const theme = useAppearance();
  return <View accessible accessibilityLabel={label ? `${value} ${label}` : value} style={[styles.chip, { backgroundColor: theme.raised }]}>
    <Text style={{ color: theme.muted, fontFamily: theme.fontFamily, fontSize: 13.5 * theme.scale, fontVariant: ['tabular-nums'] }}>
      <Text style={{ color: theme.text, fontWeight: '700' }}>{value}</Text>{label ? ` ${label}` : null}
    </Text>
  </View>;
}

export function Pill({ icon, label, accessibilityLabel, onPress, primary, outline, role = 'button' }: {
  icon: ReactNode; label: string; accessibilityLabel: string; onPress: () => void; primary?: boolean; outline?: boolean; role?: 'button' | 'link';
}) {
  const theme = useAppearance();
  const color = primary ? theme.onAccent : outline ? theme.accent : theme.text;
  return <Pressable accessibilityRole={role} accessibilityLabel={accessibilityLabel} onPress={onPress}
    style={({ pressed }) => [styles.pill, outline ? { borderWidth: 1.5, borderColor: theme.accent, flexShrink: 1 } : null,
      { backgroundColor: primary ? theme.accent : outline ? 'transparent' : theme.raised, opacity: pressed ? 0.8 : 1, transform: [{ scale: pressed ? 0.97 : 1 }] }]}>
    {icon}
    <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} style={{ flexShrink: 1, color, fontFamily: theme.fontFamily, fontSize: 17 * theme.scale, fontWeight: '700' }}>{label}</Text>
  </Pressable>;
}

export function Round({ label, onPress, href, children }: { label: string; onPress?: () => void; href?: Href; children: ReactNode }) {
  const theme = useAppearance();
  const [pressed, setPressed] = useState(false);
  const control = <Pressable accessibilityRole={href ? 'link' : 'button'} accessibilityLabel={label} onPress={onPress}
    onPressIn={() => setPressed(true)} onPressOut={() => setPressed(false)}
    style={StyleSheet.flatten([styles.round, { backgroundColor: theme.raised, opacity: pressed ? 0.8 : 1, transform: [{ scale: pressed ? 0.94 : 1 }] }])}>
    {children}
  </Pressable>;
  return href ? <Link href={href} asChild>{control}</Link> : control;
}

const styles = StyleSheet.create({
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, overflow: 'hidden' },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999 },
  pill: { flex: 1, minHeight: CONTROL, paddingHorizontal: 14, borderRadius: CONTROL / 2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  round: { width: CONTROL, height: CONTROL, borderRadius: CONTROL / 2, alignItems: 'center', justifyContent: 'center' },
});
