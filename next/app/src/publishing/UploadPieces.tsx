import type { ReactNode } from 'react';
import { Image, Pressable, View } from 'react-native';
import { router } from 'expo-router';
import FileAudio from 'lucide-react-native/icons/file-music';
import ImagePlus from 'lucide-react-native/icons/image-plus';
import Check from 'lucide-react-native/icons/check';
import { useAppearance } from '../appearance';
import { Text } from '../Text';
import type { MediaFile } from '../pds';

export function formatSize(bytes: number) {
  return bytes >= 1_048_576 ? `${(bytes / 1_048_576).toFixed(1)} MiB` : `${Math.max(1, Math.round(bytes / 1024))} KiB`;
}

/** A dashed drop-in tile for picking a file; once chosen, it names the file and offers a change. */
export function PickTile({ kind, file, hint, disabled, onPress }: { kind: 'audio' | 'artwork'; file: MediaFile | null; hint: string; disabled?: boolean; onPress: () => void }) {
  const theme = useAppearance();
  const Icon = kind === 'audio' ? FileAudio : ImagePlus;
  const empty = kind === 'audio' ? 'Choose audio' : 'Choose cover art';
  const preview = kind === 'artwork' && file?.uri ? file.uri : undefined;
  return <Pressable accessibilityRole="button" accessibilityLabel={file?.name ?? empty} accessibilityHint={file ? 'choose a different file' : undefined}
    disabled={disabled} onPress={onPress}
    style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 14, padding: 14, minHeight: 72, borderRadius: 10, borderWidth: 1,
      borderStyle: file ? 'solid' : 'dashed', borderColor: file ? theme.line : theme.border, backgroundColor: pressed ? theme.hover : theme.background, opacity: disabled ? 0.6 : 1 })}>
    {preview ? <Image source={{ uri: preview }} style={{ width: 44, height: 44, borderRadius: 6 }} />
      : <View style={{ width: 44, height: 44, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: file ? theme.accent + '22' : theme.raised }}>
        <Icon size={22} color={file ? theme.accent : theme.muted} />
      </View>}
    <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
      <Text numberOfLines={1} style={{ color: theme.text, fontFamily: theme.fontFamily, fontSize: 16 * theme.scale, fontWeight: '600' }}>{file?.name ?? empty.toLowerCase()}</Text>
      <Text numberOfLines={2} style={{ color: theme.muted, fontFamily: theme.fontFamily, fontSize: 13 * theme.scale }}>{file ? `${formatSize(file.size)} · tap to change` : hint}</Text>
    </View>
  </Pressable>;
}

/** Who can listen: everyone uploads here, just you goes to private music. */
export function AudienceToggle() {
  const theme = useAppearance();
  const segment = (label: string, selected: boolean) => <Text style={{ color: selected ? theme.onAccent : theme.muted, fontFamily: theme.fontFamily, fontSize: 14 * theme.scale, fontWeight: '600', textTransform: 'lowercase' }}>{label}</Text>;
  const box = { minHeight: 40, paddingHorizontal: 18, borderRadius: 20, justifyContent: 'center' } as const;
  return <View accessibilityLabel="who can listen" style={{ flexDirection: 'row', alignSelf: 'flex-start', padding: 4, gap: 4, borderRadius: 24, borderWidth: 1, borderColor: theme.hairline, backgroundColor: theme.raised }}>
    <Pressable accessibilityRole="button" accessibilityState={{ selected: true }} aria-pressed style={{ ...box, backgroundColor: theme.accent }}>{segment('everyone', true)}</Pressable>
    <Pressable accessibilityRole="link" onPress={() => router.push('/private')} style={({ pressed }) => ({ ...box, backgroundColor: pressed ? theme.hover : 'transparent' })}>{segment('just you', false)}</Pressable>
  </View>;
}

export function FormCard({ children }: { children: ReactNode }) {
  const theme = useAppearance();
  return <View style={{ gap: 18, padding: 18, borderRadius: 12, borderWidth: 1, borderColor: theme.hairline, backgroundColor: theme.surface }}>{children}</View>;
}

export function CheckRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  const theme = useAppearance();
  return <Pressable accessibilityRole="checkbox" accessibilityState={{ checked }} aria-checked={checked} onPress={() => onChange(!checked)}
    style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44, alignSelf: 'flex-start', opacity: pressed ? 0.7 : 1 })}>
    <View style={{ width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: checked ? theme.accent : theme.hairline, backgroundColor: checked ? theme.accent : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
      {checked && <Check size={15} color={theme.onAccent} strokeWidth={3} />}
    </View>
    <Text style={{ color: theme.text, fontFamily: theme.fontFamily, fontSize: 15 * theme.scale }}>{label}</Text>
  </Pressable>;
}
