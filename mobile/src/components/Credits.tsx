import { Pressable, StyleSheet, Text, View, type StyleProp, type TextStyle } from "react-native";
import { useAccent } from "@/settings";

type Props = {
  people: readonly { name: string; handle: string }[];
  onOpen: (handle: string) => void;
  /** The text style at rest; a name under the finger takes the accent. */
  style: StyleProp<TextStyle>;
  /** Shown after the last name, e.g. why a track cannot play here. */
  suffix?: string | null;
};

/** Who made a track, on one line, each name its own link to that artist. */
export function Credits({ people, onOpen, style, suffix = null }: Props) {
  const { accent } = useAccent();
  return (
    <View style={styles.line}>
      {people.map((person, i) => (
        <View key={person.handle} style={styles.entry}>
          <Pressable
            onPress={() => onOpen(person.handle)}
            hitSlop={{ top: 8, bottom: 10 }}
            accessibilityRole="link"
            accessibilityLabel={person.name}
            accessibilityHint="opens the artist"
            style={styles.name}
          >
            {({ pressed }) => (
              <Text style={[style, pressed && { color: accent }]} numberOfLines={1}>
                {person.name}
              </Text>
            )}
          </Pressable>
          {i < people.length - 1 ? (
            <Text style={style} accessibilityElementsHidden importantForAccessibility="no">
              {", "}
            </Text>
          ) : null}
        </View>
      ))}
      {suffix ? (
        <Text style={[style, styles.suffix]} numberOfLines={1}>
          {` · ${suffix}`}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  line: { flexDirection: "row", alignItems: "center", maxWidth: "100%" },
  entry: { flexDirection: "row", flexShrink: 1 },
  name: { flexShrink: 1 },
  suffix: { flexShrink: 0 },
});
