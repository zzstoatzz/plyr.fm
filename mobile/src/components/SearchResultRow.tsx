import { Image } from "expo-image";
import { SymbolView, type SymbolViewProps } from "expo-symbols";
import type { SearchResult } from "plyr-shared/contract";
import { IMAGE_WIDTHS, resizedImageUrl } from "plyr-shared/images";
import { resultImage, resultSubtitle, resultTitle } from "plyr-shared/search";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { color, inset, radius, thumb } from "@/theme";
import { type } from "@/type";

const GLYPH: Record<SearchResult["type"], SymbolViewProps["name"]> = {
  track: "music.note",
  artist: "person.fill",
  album: "square.stack",
  tag: "number",
  playlist: "music.note.list",
};

type Props = { result: SearchResult; active?: boolean; onPress: () => void };

/** One search hit of any kind, labeled with its kind as the web labels it. */
export function SearchResultRow({ result, active = false, onPress }: Props) {
  const title = resultTitle(result);
  const subtitle = resultSubtitle(result);
  const source = resizedImageUrl(resultImage(result), IMAGE_WIDTHS.thumb);
  const round = result.type === "artist";
  const box = { width: thumb, height: thumb, borderRadius: round ? thumb / 2 : radius.art };
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${result.type}: ${title}, ${subtitle}`}
      accessibilityState={{ selected: active }}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: color.fill }]}
    >
      {source ? (
        <Image source={source} style={[styles.art, box]} contentFit="cover" recyclingKey={source} accessibilityIgnoresInvertColors />
      ) : (
        <View style={[styles.art, styles.empty, box]}>
          <SymbolView name={GLYPH[result.type]} size={18} tintColor={color.muted} />
        </View>
      )}
      <View style={styles.text}>
        <Text style={[type.row, { color: active ? color.accent : color.ink }]} numberOfLines={1}>
          {title}
        </Text>
        <Text style={[type.meta, { color: color.muted }]} numberOfLines={1}>
          {subtitle}
        </Text>
      </View>
      <Text style={[type.badge, styles.kind, { color: color.muted, borderColor: color.border }]}>{result.type}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: inset, paddingVertical: 8, minHeight: 64 },
  art: { backgroundColor: color.fill },
  empty: { alignItems: "center", justifyContent: "center" },
  text: { flex: 1, gap: 2 },
  kind: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1, overflow: "hidden" },
});
