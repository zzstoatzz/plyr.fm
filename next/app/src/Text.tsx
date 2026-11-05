import { StyleSheet, Text as NativeText, type TextProps } from 'react-native';
import { useAppearance } from './appearance';

export function Text({ style, ...props }: TextProps) {
  const theme = useAppearance();
  const resolved = StyleSheet.flatten(style);
  const family = resolved?.fontFamily ?? theme.fontFamily;
  const comic = family === 'PlyrComic';
  const bold = resolved?.fontWeight === 'bold' || Number(resolved?.fontWeight ?? 400) >= 600;
  return <NativeText {...props} style={[
    { color: theme.text, fontFamily: theme.fontFamily }, style,
    comic && { fontFamily: bold ? 'PlyrComicBold' : 'PlyrComic', fontWeight: '400' }
  ]} />;
}
