import { Image } from "expo-image";
import { SymbolView } from "expo-symbols";
import { StyleSheet, View } from "react-native";
import { color } from "@/theme";

/** A person, as a circle. The placeholder is the same size, so rows with and without a picture line up. */
export function Avatar({ url, size }: { url: string | null | undefined; size: number }) {
  const box = { width: size, height: size, borderRadius: size / 2 };
  if (!url) {
    return (
      <View style={[styles.empty, box]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <SymbolView name="person.fill" size={size * 0.45} tintColor={color.muted} />
      </View>
    );
  }
  return <Image source={url} style={[styles.image, box]} contentFit="cover" transition={120} recyclingKey={url} accessibilityIgnoresInvertColors />;
}

const styles = StyleSheet.create({
  image: { backgroundColor: color.fill },
  empty: {
    backgroundColor: color.fill,
    alignItems: "center",
    justifyContent: "center",
  },
});
