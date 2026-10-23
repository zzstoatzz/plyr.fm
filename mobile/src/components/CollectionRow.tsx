import { SymbolView } from "expo-symbols";
import { IMAGE_WIDTHS } from "plyr-shared/images";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { color, inset, radius, thumb } from "@/theme";
import { type } from "@/type";
import { Artwork } from "./Artwork";

type Props = { title: string; detail: string; image: string | null; onPress: () => void };

/** A row that leads somewhere (a playlist on an artist's page), laid out like a track row. */
export function CollectionRow({ title, detail, image, onPress }: Props) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="link"
      accessibilityLabel={`${title}, ${detail}`}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: color.fill }]}
    >
      <Artwork url={image} size={thumb} width={IMAGE_WIDTHS.thumb} radius={radius.art} />
      <View style={styles.text}>
        <Text style={[type.row, { color: color.ink }]} numberOfLines={1}>
          {title}
        </Text>
        <Text style={[type.meta, { color: color.muted }]} numberOfLines={1}>
          {detail}
        </Text>
      </View>
      <SymbolView name="chevron.right" size={13} tintColor={color.muted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: inset, paddingVertical: 8, minHeight: 64 },
  text: { flex: 1, gap: 2 },
});
