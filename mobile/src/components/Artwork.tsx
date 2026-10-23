import { Image } from "expo-image";
import { SymbolView } from "expo-symbols";
import { resizedImageUrl } from "plyr-shared/images";
import { StyleSheet, View } from "react-native";
import { color } from "@/theme";

type Props = { url: string | null; size: number; width: number; radius: number };

/** Square artwork resized at the CDN for its slot; a note glyph stands in when there is none. */
export function Artwork({ url, size, width, radius }: Props) {
  const box = { width: size, height: size, borderRadius: radius };
  const source = resizedImageUrl(url, width);
  if (!source) {
    return (
      <View style={[styles.empty, box]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <SymbolView name="music.note" size={size * 0.4} tintColor={color.muted} />
      </View>
    );
  }
  return <Image source={source} style={[styles.image, box]} contentFit="cover" transition={120} recyclingKey={source} accessibilityIgnoresInvertColors />;
}

const styles = StyleSheet.create({
  image: { backgroundColor: color.fill },
  empty: { backgroundColor: color.fill, alignItems: "center", justifyContent: "center" },
});
