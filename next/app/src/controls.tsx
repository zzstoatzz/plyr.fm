import { usePressIntent } from './use-press-intent';
import { Text } from './Text';
import { useId, useState, type ReactNode, type Ref } from 'react';
import { Link, type Href } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, TextInput, type TextInputProps, type ScrollViewProps, type ScrollViewInstance, View } from 'react-native';
import type { Glyph } from './PlayerGlyph';
import { useAppearance } from './appearance';
import { onAccent } from './colors';

export function Action({ label, onPress, href, disabled, selected, primary, destructive, icon: Icon, onArtwork, onAccentFill }: {
  label: string; onPress?: () => void; href?: Href; disabled?: boolean; selected?: boolean; primary?: boolean; destructive?: boolean; icon?: Glyph; onArtwork?: boolean;
  /** Sits on an accent-filled surface, such as a coachmark. */
  onAccentFill?: boolean;
}) {
  const theme = useAppearance();
  const [pressed, setPressed] = useState(false);
  const press = usePressIntent(onPress);
  const fill = primary ? destructive ? theme.danger : theme.accent : undefined;
  const ink = fill ? destructive ? onAccent(fill) : theme.onAccent : onAccentFill ? theme.onAccent : onArtwork ? '#ffffff' : destructive ? theme.danger : theme.text;
  const control = <Pressable accessibilityRole={href ? 'link' : 'button'} accessibilityState={{ disabled, selected }} aria-pressed={selected}
    disabled={disabled} onPointerDown={press.onPointerDown} onPress={press.onPress} onPressIn={() => { press.onPressIn(); setPressed(true); }} onPressOut={() => { press.onPressOut(); setPressed(false); }}
    style={{ ...styles.button, backgroundColor: fill ?? (onAccentFill ? pressed ? theme.onAccent + '26' : 'transparent' : onArtwork ? pressed ? '#ffffff33' : '#00000059' : pressed ? theme.hover : selected ? theme.surface : 'transparent'), opacity: disabled ? 0.5 : pressed && fill ? 0.85 : 1,
      borderColor: fill ?? (onAccentFill ? theme.onAccent : onArtwork ? '#ffffff80' : selected ? theme.accent : theme.line) }}>
    {Icon && <Icon size={18} color={ink} fill={primary ? ink : 'none'} />}
    <Text style={{ color: ink, fontFamily: theme.fontFamily, fontSize: 14 * theme.scale, fontWeight: '600', textAlign: 'center', textTransform: 'lowercase', flexShrink: 1 }}>{label}</Text>
  </Pressable>;
  return href ? <Link href={href} asChild>{control}</Link> : control;
}

export function Page({ title, children, scrollRef, ...scrollProps }: { title: string; children: ReactNode; scrollRef?: Ref<ScrollViewInstance> } & Pick<ScrollViewProps, 'scrollEnabled' | 'onScroll' | 'onContentSizeChange' | 'onLayout'>) {
  const theme = useAppearance();
  return <ScrollView ref={scrollRef} {...scrollProps} scrollEventThrottle={16} keyboardShouldPersistTaps="handled" style={{ backgroundColor: theme.background }} contentContainerStyle={styles.page}>
    <Text accessibilityRole="header" aria-level={1} style={{ color: theme.text, fontSize: 28 * theme.scale, fontFamily: theme.fontFamily, fontWeight: '700', textTransform: 'lowercase' }}>{title}</Text>
    {children}
  </ScrollView>;
}

export function Copy({ children, live = false }: { children: ReactNode; live?: boolean }) {
  const theme = useAppearance();
  return <Text accessibilityLiveRegion={live ? 'polite' : undefined} style={{ color: theme.muted, fontFamily: theme.fontFamily, fontSize: 15 * theme.scale, lineHeight: 22 * theme.scale }}>{children}</Text>;
}

export function Field({ label, style, onFocus, onBlur, multiline, ...props }: TextInputProps & { label: string }) {
  const theme = useAppearance();
  const id = useId();
  const [focused, setFocused] = useState(false);
  return <View style={{ gap: 6, minWidth: 0 }}>
    <Text nativeID={id} style={{ color: theme.text, fontSize: 15 * theme.scale, lineHeight: 22 * theme.scale }}>{label}</Text>
    <TextInput {...props} accessibilityLabel={label} aria-labelledby={id} placeholderTextColor={theme.muted} multiline={multiline}
      onFocus={event => { setFocused(true); onFocus?.(event); }} onBlur={event => { setFocused(false); onBlur?.(event); }}
      style={[styles.input, { color: theme.text, backgroundColor: theme.surface, fontFamily: theme.fontFamily, fontSize: 16 * theme.scale,
        borderColor: focused ? theme.accent : theme.border, opacity: props.editable === false ? 0.6 : 1 },
        multiline && { minHeight: 112, textAlignVertical: 'top' }, style]} />
  </View>;
}

export function InlineLink({ href, children, standalone = false }: { href: Href; children: ReactNode; standalone?: boolean }) {
  const theme = useAppearance();
  return <Link href={href} style={{ color: theme.accent, textDecorationLine: 'underline', fontFamily: theme.fontFamily, fontSize: 15 * theme.scale, lineHeight: 22 * theme.scale, ...(standalone ? { minHeight: 44, paddingVertical: 11 } : {}) }}>{children}</Link>;
}

export const pageFrame = { width: '100%', maxWidth: 824, alignSelf: 'center', paddingHorizontal: 20 } as const;
/** The frame for pages laid out for a desktop window: home and library past `DESKTOP_HOME_WIDTH`. */
export const wideFrame = { width: '100%', maxWidth: 1320, alignSelf: 'center', paddingHorizontal: 36 } as const;

export const row = { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 } as const;
const styles = StyleSheet.create({
  page: { ...pageFrame, gap: 16, paddingTop: 16, paddingBottom: 32 },
  button: { minHeight: 44, flexDirection: 'row', gap: 8, justifyContent: 'center', alignItems: 'center', borderRadius: 24, borderWidth: 1, paddingHorizontal: 20, paddingVertical: 10, maxWidth: '100%' },
  input: { minHeight: 48, padding: 12, borderRadius: 8, borderWidth: 1 }
});
