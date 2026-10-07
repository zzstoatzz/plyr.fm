import { SymbolView } from "expo-symbols";
import { IMAGE_WIDTHS } from "plyr-shared/images";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { color, inset, radius, thumb } from "@/theme";
import { type } from "@/type";
import { Artwork } from "./Artwork";

type Props = {
  title: string;
  artist: string;
  artwork: string | null;
  active?: boolean;
  /** Why it cannot play here, e.g. "supporters only"; the row stays readable but quiet. */
  locked?: string | null;
  onPress: () => void;
};

export function TrackRow({ title, artist, artwork, active = false, locked = null, onPress }: Props) {
  return (
    <Pressable
      onPress={onPress}
      disabled={locked !== null}
      accessibilityRole="button"
      accessibilityLabel={`${title}, by ${artist}`}
      accessibilityHint={locked ?? (active ? "now playing" : "plays this track")}
      accessibilityState={{ disabled: locked !== null, selected: active }}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: color.fill }]}
    >
      <View style={locked ? styles.quiet : null}>
        <Artwork url={artwork} size={thumb} width={IMAGE_WIDTHS.thumb} radius={radius.art} />
      </View>
      <View style={[styles.text, locked ? styles.quiet : null]}>
        <Text style={[type.row, { color: active ? color.accent : color.ink }]} numberOfLines={1}>
          {title}
        </Text>
        <Text style={[type.meta, { color: color.muted }]} numberOfLines={1}>
          {locked ? `${artist} · ${locked}` : artist}
        </Text>
      </View>
      {active ? <SymbolView name="waveform" size={18} tintColor={color.accent} /> : null}
      {locked ? <SymbolView name="lock.fill" size={14} tintColor={color.muted} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: inset, paddingVertical: 8, minHeight: 64 },
  text: { flex: 1, gap: 2 },
  quiet: { opacity: 0.55 },
});
