import { SymbolView, type SFSymbol } from "expo-symbols";
import { Pressable, StyleSheet, Text } from "react-native";
import { color } from "@/theme";
import { type } from "@/type";
import { useAccent } from "@/settings";

type Props = { label: string; symbol: SFSymbol; kind?: "filled" | "tinted"; role?: "button" | "link"; hint?: string; onPress: () => void };

/** The pill a detail screen acts through: filled for the main thing (play), tinted beside it as the web tints support. */
export function Button({ label, symbol, kind = "filled", role = "button", hint, onPress }: Props) {
  const { accent, tintBorder, tintFill } = useAccent();
  const ink = kind === "filled" ? color.onAccent : accent;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole={role}
      accessibilityLabel={label}
      accessibilityHint={hint}
      style={({ pressed }) => [
        styles.pill,
        kind === "filled" ? { backgroundColor: accent } : { borderWidth: 1, borderColor: tintBorder, backgroundColor: tintFill },
        pressed && { opacity: 0.7 },
      ]}
    >
      <SymbolView name={symbol} size={14} tintColor={ink} />
      <Text style={[type.secondary, type.strong, { color: ink }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pill: { flexDirection: "row", alignItems: "center", gap: 6, borderRadius: 22, minHeight: 44, paddingHorizontal: 22, borderCurve: "continuous" },
});
