import { SymbolView } from "expo-symbols";
import { tagHue } from "plyr-shared/tags";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { color, inset } from "@/theme";
import { type } from "@/type";

type Props = {
  tags: readonly { name: string }[];
  selected?: readonly string[];
  onPress: (name: string) => void;
  onClear?: () => void;
  wrap?: boolean;
};

/** Tag chips, each tinted by the same hue the web gives it; text stays ink so it always reads. */
export function TagChips({ tags, selected = [], onPress, onClear, wrap = false }: Props) {
  const chips = tags.map(({ name }) => {
    const hue = tagHue(name);
    const on = selected.includes(name);
    return (
      <Pressable
        key={name}
        onPress={() => onPress(name)}
        accessibilityRole="button"
        accessibilityLabel={name}
        accessibilityState={{ selected: on }}
        hitSlop={{ top: 4, bottom: 4 }}
        style={({ pressed }) => [
          styles.chip,
          { borderColor: `hsla(${hue}, 55%, 55%, ${on ? 1 : 0.45})` },
          on && { backgroundColor: `hsla(${hue}, 60%, 50%, 0.2)` },
          pressed && { opacity: 0.6 },
        ]}
      >
        <Text style={[type.secondary, { color: on ? color.ink : color.muted, fontWeight: on ? "600" : "400" }]}>{name}</Text>
      </Pressable>
    );
  });
  const clear =
    onClear && selected.length > 0 ? (
      <Pressable key="clear" onPress={onClear} accessibilityRole="button" accessibilityLabel="clear tags" hitSlop={8} style={[styles.chip, styles.clear]}>
        <SymbolView name="xmark" size={12} tintColor={color.muted} />
      </Pressable>
    ) : null;
  if (wrap) return <View style={[styles.row, styles.wrap]}>{chips}</View>;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
      {clear}
      {chips}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { paddingHorizontal: inset, gap: 8, paddingVertical: 4 },
  wrap: { flexWrap: "wrap", flexDirection: "row" },
  chip: { borderWidth: 1, borderRadius: 16, paddingHorizontal: 12, minHeight: 32, justifyContent: "center", alignItems: "center", borderCurve: "continuous" },
  clear: { borderColor: color.border, paddingHorizontal: 10 },
});
