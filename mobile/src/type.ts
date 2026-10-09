import { StyleSheet } from "react-native";

/** Comic Neue, bundled through the expo-font plugin: the web's comic sans choice, in a face drawn to stay readable. */
export const font = { regular: "ComicNeue-Regular", bold: "ComicNeue-Bold" } as const;

// each weight is named by its own file: asking the family for a weight does not find the bold face
export const type = StyleSheet.create({
  title: { fontFamily: font.bold, fontSize: 24 },
  section: { fontFamily: font.bold, fontSize: 21 },
  row: { fontFamily: font.bold, fontSize: 17 },
  body: { fontFamily: font.regular, fontSize: 17 },
  secondary: { fontFamily: font.regular, fontSize: 15 },
  meta: { fontFamily: font.regular, fontSize: 14 },
  badge: { fontFamily: font.bold, fontSize: 12 },
  strong: { fontFamily: font.bold },
  // Comic Neue has no tabular figures, so times stay in the system face, where digits hold their width
  numeric: { fontFamily: "System", fontVariant: ["tabular-nums"] },
});
