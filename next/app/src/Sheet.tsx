import { useState, type ReactNode } from 'react';
import { X } from './icons';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppearance } from './appearance';
import { Heading } from './CatalogPieces';
import { useLayer } from './behaviors/use-layer';
import { CompactRows } from './ActionRow';

/** Where the control that opened a sheet sits in the window. */
export type Anchor = { x: number; y: number; width: number; height: number };
const MENU_WIDTH = 248;

export function Sheet({ title, close, children, notice, visible = true, onDismiss, anchor }: {
  title: string; close: () => void; children: ReactNode; notice?: ReactNode; visible?: boolean; onDismiss?: () => void;
  /** On a wide window, open as a dropdown beside this control instead of a centered sheet. */
  anchor?: Anchor;
}) {
  const theme = useAppearance();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [panel, setPanel] = useState(0);
  const wide = width >= 800;
  useLayer(visible);
  if (anchor && wide) {
    const left = anchor.x - MENU_WIDTH - 6 >= 8 ? anchor.x - MENU_WIDTH - 6 : Math.min(anchor.x + anchor.width + 6, width - MENU_WIDTH - 8);
    const top = Math.max(8, Math.min(anchor.y + anchor.height / 2 - panel / 2, height - panel - 8));
    return <Modal transparent accessibilityLabel={title} animationType="none" visible={visible} onDismiss={onDismiss} onRequestClose={close}>
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
    </Modal>;
  }
  return <Modal transparent accessibilityLabel={title} animationType={theme.reduceMotion ? 'none' : 'fade'} visible={visible} onDismiss={onDismiss} onRequestClose={close}>
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1, justifyContent: wide ? 'center' : 'flex-end', alignItems: 'center' }}>
      <Pressable accessible={false} focusable={false} tabIndex={-1} aria-hidden onPress={close}
        style={[StyleSheet.absoluteFill, { backgroundColor: '#0008' }]} />
      <View accessibilityViewIsModal={Platform.OS === 'web' ? undefined : true} style={{
        width: '100%', maxWidth: 520, maxHeight: '88%', borderTopLeftRadius: 22, borderTopRightRadius: 22,
        borderBottomLeftRadius: wide ? 22 : 0, borderBottomRightRadius: wide ? 22 : 0,
        backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.hairline, paddingBottom: wide ? 12 : insets.bottom
      }}>
        <View style={{ paddingHorizontal: 20, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View style={{ flex: 1, minWidth: 0 }}><Heading>{title}</Heading></View>
          <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={close} style={{ padding: 12 }}><X size={22} color={theme.text} /></Pressable>
        </View>
        {notice && <View style={{ paddingHorizontal: 20, paddingBottom: 12, gap: 12 }}>{notice}</View>}
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 20, paddingTop: 4, gap: 12 }}>
          {children}
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  </Modal>;
}
