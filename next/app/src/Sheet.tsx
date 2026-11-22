import { useEffect, useRef, useState, type ReactNode } from 'react';
import { X } from './icons';
import { Animated, Modal, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { SafeAreaProvider, initialWindowMetrics, useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeepInViewContext, useKeepInView } from './behaviors/keep-in-view';
import { useKeyboardInset } from './behaviors/use-keyboard-inset';
import { useAppearance } from './appearance';
import { Heading } from './CatalogPieces';
import { useLayer } from './behaviors/use-layer';
import { CompactRows } from './ActionRow';
import { Text } from './Text';

/** Where the control that opened a sheet sits in the window. */
export type Anchor = { x: number; y: number; width: number; height: number };
const MENU_WIDTH = 248;

/** A long-pressed row, shown lifted above the page with the menu beside it. */
export type Lift = { anchor: Anchor; preview: ReactNode };

/** A form sheet's navigation bar: a way out on the left and its one action on the right, both always in view. */
export type SheetBar = { leading: ReactNode; trailing: ReactNode };

type SheetProps = {
  title: string; close: () => void; children: ReactNode; notice?: ReactNode; visible?: boolean; onDismiss?: () => void;
  bar?: SheetBar;
  /** On a wide window, open as a dropdown beside this control instead of a centered sheet. */
  anchor?: Anchor;
  lift?: Lift;
};

export function Sheet(props: SheetProps) {
  const { title, close, visible = true, onDismiss, anchor, lift } = props;
  const theme = useAppearance();
  const { width } = useWindowDimensions();
  useLayer(visible);
  const dropdown = !lift && !!anchor && width >= 800;
  // A Modal is its own native window; the app's safe area provider reports no insets inside it.
  return <Modal transparent accessibilityLabel={title} animationType={dropdown || theme.reduceMotion ? 'none' : 'fade'} visible={visible} onDismiss={onDismiss} onRequestClose={close}>
    <SafeAreaProvider><SheetBody {...props} /></SafeAreaProvider>
  </Modal>;
}

function SheetBody({ title, close, children, notice, anchor, lift, bar }: SheetProps) {
  const theme = useAppearance();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [panel, setPanel] = useState(0);
  const keeper = useKeepInView();
  const wide = width >= 800;
  const form = !!bar && !wide;
  const keyboard = useKeyboardInset(!lift && !(anchor && wide) && !form);
  if (lift) return <LiftedMenu title={title} close={close} lift={lift} notice={notice}>{children}</LiftedMenu>;
  if (anchor && wide) {
    const left = anchor.x - MENU_WIDTH - 6 >= 8 ? anchor.x - MENU_WIDTH - 6 : Math.min(anchor.x + anchor.width + 6, width - MENU_WIDTH - 8);
    const top = Math.max(8, Math.min(anchor.y + anchor.height / 2 - panel / 2, height - panel - 8));
    return <>
      <Pressable accessible={false} focusable={false} tabIndex={-1} aria-hidden onPress={close} style={StyleSheet.absoluteFill} />
      <View aria-label={title} onLayout={event => setPanel(event.nativeEvent.layout.height)} style={{
        position: 'absolute', left, top, width: MENU_WIDTH, maxHeight: height - 16, opacity: panel ? 1 : 0,
        backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.line, borderRadius: 12, padding: 6,
        boxShadow: theme.dark ? '0px 12px 32px #000000a6' : '0px 12px 32px #00000029'
      }}>
        <CompactRows.Provider value>
          {notice && <View style={{ padding: 8, gap: 8 }}>{notice}</View>}
          <ScrollView keyboardShouldPersistTaps="handled">{children}</ScrollView>
        </CompactRows.Provider>
      </View>
    </>;
  }
  // A form sheet on a phone keeps its height and lets the keyboard cover its lower part; its scroll view
  // insets for the keyboard and brings the focused field into view. Lifting it as well would count the keyboard twice.
  // Any other sheet rises to sit on the keyboard.
  return <View style={{ flex: 1, justifyContent: wide ? 'center' : 'flex-end', alignItems: 'center', paddingBottom: keyboard }}>
    <Pressable accessible={false} focusable={false} tabIndex={-1} aria-hidden onPress={close}
      style={[StyleSheet.absoluteFill, { backgroundColor: '#0008' }]} />
    <View accessibilityViewIsModal={true} style={{
      width: '100%', maxWidth: 520, borderTopLeftRadius: 22, borderTopRightRadius: 22, overflow: 'hidden',
      borderBottomLeftRadius: wide ? 22 : 0, borderBottomRightRadius: wide ? 22 : 0,
      backgroundColor: theme.surface, borderWidth: 1, borderBottomWidth: wide ? 1 : 0, borderColor: theme.hairline,
      ...(form ? { height: height - Math.max(insets.top, initialWindowMetrics?.insets.top ?? 0) - 10 }
        : { maxHeight: height - keyboard - Math.max(insets.top, initialWindowMetrics?.insets.top ?? 0) - 10, paddingBottom: wide || keyboard ? 12 : insets.bottom })
    }}>
      {bar ? <View style={{ paddingHorizontal: 8, paddingVertical: 6, flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, borderColor: theme.hairline }}>
        <View style={{ flex: 1, alignItems: 'flex-start' }}>{bar.leading}</View>
        <Heading>{title}</Heading>
        <View style={{ flex: 1, alignItems: 'flex-end' }}>{bar.trailing}</View>
      </View> : <View style={{ paddingHorizontal: 20, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <View style={{ flex: 1, minWidth: 0 }}><Heading>{title}</Heading></View>
        <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={close} style={{ padding: 12 }}><X size={22} color={theme.text} /></Pressable>
      </View>}
      {notice && <View style={{ paddingHorizontal: 20, paddingTop: bar ? 12 : 0, paddingBottom: 12, gap: 12, borderBottomWidth: bar ? StyleSheet.hairlineWidth : 0, borderColor: theme.hairline }}>{notice}</View>}
      <ScrollView ref={keeper.scroll} onScroll={keeper.onScroll} scrollEventThrottle={16} style={form ? { flex: 1 } : undefined}
        keyboardShouldPersistTaps="handled" keyboardDismissMode={form ? 'interactive' : 'none'} automaticallyAdjustKeyboardInsets={form}
        contentContainerStyle={{ padding: 20, paddingTop: bar ? 16 : 4, paddingBottom: form ? 20 + insets.bottom : 20, gap: 12 }}>
        <KeepInViewContext.Provider value={form ? keeper.keep : undefined}>{children}</KeepInViewContext.Provider>
      </ScrollView>
    </View>
  </View>;
}

function LiftedMenu({ title, close, lift: { anchor, preview }, notice, children }: {
  title: string; close: () => void; lift: Lift; notice?: ReactNode; children: ReactNode;
}) {
  const theme = useAppearance();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [panel, setPanel] = useState(0);
  const shown = useRef(new Animated.Value(theme.reduceMotion ? 1 : 0)).current;
  useEffect(() => {
    if (!panel || theme.reduceMotion) return;
    Animated.spring(shown, { toValue: 1, useNativeDriver: true, speed: 22, bounciness: 6 }).start();
  }, [panel, shown, theme.reduceMotion]);
  const top = insets.top + 8, bottom = height - insets.bottom - 8;
  const gap = 8;
  // Keep the row where it was when the menu fits below or above it; otherwise slide the row up just enough.
  const below = anchor.y + anchor.height + gap + panel <= bottom;
  const above = !below && anchor.y - gap - panel >= top;
  const rowTop = below || above ? anchor.y : Math.max(top, bottom - panel - gap - anchor.height);
  const menuTop = above ? anchor.y - gap - panel : rowTop + anchor.height + gap;
  const menuWidth = Math.min(MENU_WIDTH + 24, width - 16);
  const left = Math.max(8, Math.min(anchor.x + 8, width - menuWidth - 8));
  const scale = shown.interpolate({ inputRange: [0, 1], outputRange: [1, 1.03] });
  return <>
    <Pressable accessibilityRole="button" accessibilityLabel="Close menu" onPress={close} style={[StyleSheet.absoluteFill, { backgroundColor: theme.dark ? '#000000b8' : '#00000066' }]} />
    <Animated.View pointerEvents="none" style={{ position: 'absolute', left: anchor.x, top: rowTop, width: anchor.width, opacity: panel ? 1 : 0,
      transform: [{ scale }], boxShadow: theme.dark ? '0px 14px 30px #000000b0' : '0px 14px 30px #00000038', borderRadius: 12 }}>
      {preview}
    </Animated.View>
    <Animated.View accessibilityViewIsModal aria-label={title} onLayout={event => setPanel(event.nativeEvent.layout.height)} style={{
      position: 'absolute', left, top: menuTop, width: menuWidth, maxHeight: bottom - top, opacity: panel ? shown : 0,
      transform: [{ translateY: shown.interpolate({ inputRange: [0, 1], outputRange: [above ? 6 : -6, 0] }) }],
      backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.line, borderRadius: 14, padding: 6,
      boxShadow: theme.dark ? '0px 16px 40px #000000c0' : '0px 16px 40px #00000033'
    }}>
      <CompactRows.Provider value>
        {notice && <View style={{ padding: 8, gap: 8 }}>{notice}</View>}
        <ScrollView keyboardShouldPersistTaps="handled" bounces={false}>{children}</ScrollView>
      </CompactRows.Provider>
    </Animated.View>
  </>;
}

/** A text button for a form sheet's bar. */
export function BarButton({ label, onPress, disabled, strong }: { label: string; onPress: () => void; disabled?: boolean; strong?: boolean }) {
  const theme = useAppearance();
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} hitSlop={8}
    style={({ pressed }) => ({ paddingHorizontal: 12, paddingVertical: 10, opacity: disabled ? 0.4 : pressed ? 0.6 : 1 })}>
    <Text style={{ color: theme.accent, fontFamily: theme.fontFamily, fontSize: 17 * theme.scale, fontWeight: strong ? '700' : '400' }}>{label}</Text>
  </Pressable>;
}
