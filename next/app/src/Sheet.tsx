import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import X from 'lucide-react-native/icons/x';
import { useAppearance } from './appearance';
import { Heading } from './CatalogPieces';

export function Sheet({ title, close, children, notice }: { title: string; close: () => void; children: ReactNode; notice?: ReactNode }) {
  const theme = useAppearance();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const wide = width >= 800;
  return <Modal transparent accessibilityLabel={title} animationType={theme.reduceMotion ? 'none' : 'fade'} visible onRequestClose={close}>
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
