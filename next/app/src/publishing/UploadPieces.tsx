import { useEffect, useState, type ReactNode } from 'react';
import { FileAudio, Globe, ImageSquare as ImagePlus, Check, Lock, PencilSimple, PlusCircle, Waveform, X } from '../icons';
import { measureAudioDuration } from '../media-picker';
import { Image, Pressable, Switch, TextInput, View } from 'react-native';
import { useAppearance } from '../appearance';
import { inputFontSize } from '../controls';
import { Text } from '../Text';
import type { MediaFile } from '../pds';
import { usePreviewUri } from './preview-uri';

export type TrackDraftFields = {
  file: MediaFile | null; artwork: MediaFile | null; title: string; description: string; tags: string;
  setFile: (file: MediaFile | null) => void; setArtwork: (file: MediaFile | null) => void; setTitle: (text: string) => void;
  setDescription: (text: string) => void; setTags: (text: string) => void;
};

export function formatSize(bytes: number) {
  return bytes >= 1_048_576 ? `${(bytes / 1_048_576).toFixed(1)} MiB` : `${Math.max(1, Math.round(bytes / 1024))} KiB`;
}

/** A dashed drop-in tile for picking a file; once chosen, it names the file and offers a change. */
export function PickTile({ kind, file, hint, disabled, onPress }: { kind: 'audio' | 'artwork'; file: MediaFile | null; hint: string; disabled?: boolean; onPress: () => void }) {
  const theme = useAppearance();
  const Icon = kind === 'audio' ? FileAudio : ImagePlus;
  const empty = kind === 'audio' ? 'Choose audio' : 'Choose cover art';
  const uri = usePreviewUri(kind === 'artwork' ? file : null);
  const preview = kind === 'artwork' ? uri : undefined;
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

export function AudienceToggle({ onlyYou, select, disabled }: { onlyYou: boolean; select: (value: boolean) => void; disabled: boolean }) {
  const theme = useAppearance();
  const segment = (label: string, selected: boolean) => {
    const Glyph = label === 'everyone' ? Globe : Lock;
    return <><Glyph size={15} color={selected ? theme.text : theme.muted} /><Text style={{ color: selected ? theme.text : theme.muted, fontFamily: theme.fontFamily, fontSize: 14 * theme.scale, fontWeight: '600', textTransform: 'lowercase' }}>{label}</Text></>;
  };
  const box = { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 40, paddingHorizontal: 12, borderRadius: 20, justifyContent: 'center' } as const;
  return <View accessibilityLabel="who can listen" style={{ flexDirection: 'row', alignSelf: 'flex-start', padding: 4, gap: 4, borderRadius: 24, borderWidth: 1, borderColor: theme.hairline, backgroundColor: theme.raised }}>
    {[false, true].map(value => {
      const selected = value === onlyYou;
      return <Pressable key={String(value)} accessibilityRole="button" accessibilityState={{ selected, disabled }} disabled={disabled} onPress={() => select(value)}
        style={({ pressed }) => ({ ...box, backgroundColor: selected ? theme.surface : pressed ? theme.hover : 'transparent', ...(selected ? { shadowColor: '#000', shadowOpacity: 0.14, shadowRadius: 3, shadowOffset: { width: 0, height: 1 } } : null) })}>
        {segment(value ? 'only you' : 'everyone', selected)}
      </Pressable>;
    })}
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
    <View style={{ width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: checked ? theme.accent : theme.border, backgroundColor: checked ? theme.accent : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
      {checked && <Check size={15} color={theme.onAccent} strokeWidth={3} />}
    </View>
    <Text style={{ color: theme.text, fontFamily: theme.fontFamily, fontSize: 15 * theme.scale }}>{label}</Text>
  </Pressable>;
}

/** An error under the field that caused it, announced as it appears. */
export function FieldError({ children }: { children: ReactNode }) {
  const theme = useAppearance();
  return <Text role="alert" accessibilityLiveRegion="polite" style={{ color: theme.danger, fontFamily: theme.fontFamily, fontSize: 14 * theme.scale, lineHeight: 20 * theme.scale }}>{children}</Text>;
}

export function clock(seconds: number) {
  const whole = Math.round(seconds);
  const hours = Math.floor(whole / 3600);
  const rest = `${Math.floor(whole / 60) % 60}:${String(whole % 60).padStart(2, '0')}`;
  return hours ? `${hours}:${rest.padStart(5, '0')}` : rest;
}

export function Chip({ label, strong, icon: Glyph, onPress }: { label: string; strong?: boolean; icon?: typeof Waveform; onPress?: () => void }) {
  const theme = useAppearance();
  const body = <>
    {Glyph && <Glyph size={15} color={theme.text} />}
    <Text numberOfLines={1} style={{ flexShrink: 1, color: strong || onPress ? theme.text : theme.muted, fontFamily: theme.fontFamily, fontSize: 13 * theme.scale, fontWeight: strong || onPress ? '700' : '400', fontVariant: ['tabular-nums'] }}>{label}</Text>
  </>;
  const style = { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 32, maxWidth: '100%', paddingHorizontal: 12, borderRadius: 16, backgroundColor: theme.raised } as const;
  return onPress
    ? <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({ pressed }) => ({ ...style, backgroundColor: pressed ? theme.hover : theme.raised })}>{body}</Pressable>
    : <View style={style}>{body}</View>;
}

/** Before a file is picked, the page is one invitation to choose a track. */
export function ChooseTrack({ onPress, artist, children }: { onPress: () => void; artist?: string; children?: ReactNode }) {
  const theme = useAppearance();
  const type = (size: number, weight: '400' | '700' = '400', color = theme.muted) => ({ color, fontFamily: theme.fontFamily, fontSize: size * theme.scale, fontWeight: weight, textAlign: 'center' } as const);
  return <View style={{ alignItems: 'center', gap: 12, paddingVertical: 36, paddingHorizontal: 20, borderRadius: 20, borderWidth: 2, borderStyle: 'dashed', borderColor: theme.accent + '73', backgroundColor: theme.surface }}>
    <View style={{ width: 72, height: 72, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.accent + '29' }}>
      <Waveform size={34} color={theme.accent} />
    </View>
    <Text accessibilityRole="header" style={type(24, '700', theme.text)}>choose a track</Text>
    <Text style={type(15)}>from files, voice memos or the share sheet. the title comes from the file name; everything else is optional.</Text>
    <Pressable accessibilityRole="button" accessibilityLabel="Choose audio" onPress={onPress}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 48, paddingHorizontal: 24, borderRadius: 24, backgroundColor: theme.accent, opacity: pressed ? 0.85 : 1 })}>
      <PlusCircle size={20} color={theme.onAccent} />
      <Text style={type(16, '700', theme.onAccent)}>choose audio</Text>
    </Pressable>
    <Text style={type(13, '400', theme.faint)}>mp3, wav, flac, aiff, ogg, opus, m4a or aac · up to 1.5 GB</Text>
    {children}
    {!!artist && <Text style={type(13, '400', theme.faint)}>posts to your profile as {artist}</Text>}
  </View>;
}

/** The upload as the track page it will become: cover, title, who it posts as, and the file. */
export function TrackHero({ artwork, onArtwork, onRemoveArtwork, title, setTitle, artist, file, reattach, onAudio, children }: {
  artwork: MediaFile | null; onArtwork: () => void; onRemoveArtwork: () => void; title: string; setTitle: (text: string) => void;
  artist?: string; file: MediaFile | null; reattach: boolean; onAudio: () => void; children?: ReactNode;
}) {
  const theme = useAppearance();
  const cover = usePreviewUri(artwork);
  const [duration, setDuration] = useState<number>();
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    let live = true;
    setDuration(undefined);
    if (file) measureAudioDuration(file).then(value => { if (live) setDuration(value); }, () => {});
    return () => { live = false; };
  }, [file]);
  return <View style={{ alignItems: 'center', gap: 12, padding: cover ? 16 : 0, paddingTop: cover ? 20 : 4, marginBottom: cover ? 8 : 0, borderRadius: 24, overflow: 'hidden' }}>
    {cover && <>
      <Image source={{ uri: cover }} blurRadius={60} accessibilityIgnoresInvertColors style={{ position: 'absolute', top: -60, left: -60, right: -60, bottom: -60 }} />
      <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: theme.background, opacity: theme.dark ? 0.55 : 0.45 }} />
    </>}
    <View style={{ width: '58%', maxWidth: 260, aspectRatio: 1 }}>
      <Pressable accessibilityRole="button" accessibilityLabel={artwork ? 'Change cover' : 'Choose cover'} onPress={onArtwork}
        style={({ pressed }) => ({ flex: 1, borderRadius: 14, overflow: 'hidden', opacity: pressed ? 0.85 : 1,
          ...(cover ? { shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 18, shadowOffset: { width: 0, height: 12 } }
            : { borderWidth: 2, borderStyle: 'dashed', borderColor: theme.line, backgroundColor: theme.surface }) })}>
        {cover ? <>
          <Image source={{ uri: cover }} style={{ width: '100%', height: '100%', borderRadius: 14 }} />
          <View style={{ position: 'absolute', left: 10, bottom: 10, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 14, backgroundColor: '#0000008c' }}>
            <ImagePlus size={14} color="#ffffff" />
            <Text style={{ color: '#ffffff', fontFamily: theme.fontFamily, fontSize: 12 * theme.scale, fontWeight: '700' }}>change cover</Text>
          </View>
        </> : <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 6, padding: 12 }}>
          <ImagePlus size={30} color={theme.faint} />
          <Text style={{ color: theme.text, fontFamily: theme.fontFamily, fontSize: 15 * theme.scale, fontWeight: '700' }}>add a cover</Text>
          <Text style={{ color: theme.faint, fontFamily: theme.fontFamily, fontSize: 12 * theme.scale, textAlign: 'center' }}>optional · any photo or image</Text>
        </View>}
      </Pressable>
      {artwork && <Pressable accessibilityRole="button" accessibilityLabel="Remove cover" onPress={onRemoveArtwork} hitSlop={8}
        style={{ position: 'absolute', top: 8, right: 8, width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0000008c' }}>
        <X size={16} color="#ffffff" />
      </Pressable>}
    </View>
    <Text style={{ color: theme.faint, fontFamily: theme.fontFamily, fontSize: 12 * theme.scale, fontWeight: '700', letterSpacing: 0.8 }}>NEW TRACK</Text>
    <View style={{ alignSelf: 'stretch', justifyContent: 'center', paddingHorizontal: 28, borderBottomWidth: focused ? 2 : 1, borderColor: focused ? theme.accent : theme.line, paddingBottom: 4 }}>
      <TextInput value={title} onChangeText={setTitle} maxLength={256} accessibilityLabel="Title" placeholder="name this track" placeholderTextColor={theme.faint}
        onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} returnKeyType="done"
        style={{ minWidth: 0, color: theme.text, fontFamily: theme.fontFamily, fontSize: inputFontSize(theme.scale) * 1.75, fontWeight: '700', textAlign: 'center', paddingVertical: 4 }} />
      <PencilSimple size={18} color={theme.faint} style={{ position: 'absolute', right: 4, top: '50%', marginTop: -11 }} />
    </View>
    {!!artist && <Text style={{ alignSelf: 'stretch', textAlign: 'center', color: theme.muted, fontFamily: theme.fontFamily, fontSize: 15 * theme.scale }}>posts to your profile as {artist}</Text>}
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 6, alignSelf: 'stretch' }}>
      {file ? <>
        {!!duration && <Chip strong label={clock(duration)} />}
        <Chip label={`${file.name} · ${formatSize(file.size)}`} />
        <Chip icon={Waveform} label="change audio" onPress={onAudio} />
      </> : <>
        {reattach && <Chip label="your draft is still here. choose the audio file again." />}
        <Chip icon={Waveform} label="choose audio" onPress={onAudio} />
      </>}
    </View>
    {children}
  </View>;
}

export function SwitchRow({ label, detail, value, onChange }: { label: string; detail: string; value: boolean; onChange: (value: boolean) => void }) {
  const theme = useAppearance();
  return <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
    <View style={{ flex: 1, gap: 2 }}>
      <Text style={{ color: theme.text, fontFamily: theme.fontFamily, fontSize: 15 * theme.scale, fontWeight: '700' }}>{label}</Text>
      <Text style={{ color: theme.muted, fontFamily: theme.fontFamily, fontSize: 13 * theme.scale, lineHeight: 18 * theme.scale }}>{detail}</Text>
    </View>
    <Switch accessibilityLabel={label} value={value} onValueChange={onChange} trackColor={{ true: theme.accent, false: theme.hover }} />
  </View>;
}

/** Who can listen beside the upload button, at the end of the form. */
export function UploadBar({ audience, children }: { audience: ReactNode; children: ReactNode }) {
  const theme = useAppearance();
  return <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, padding: 6, borderRadius: 32, borderWidth: 1, borderColor: theme.glassBorder, backgroundColor: theme.glass }}>
    {audience}
    <View style={{ flex: 1 }}>{children}</View>
  </View>;
}
