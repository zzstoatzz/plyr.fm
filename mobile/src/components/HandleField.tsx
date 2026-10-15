import { SymbolView } from "expo-symbols";
import type { Actor } from "plyr-shared/account";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import Animated, { FadeIn, LinearTransition } from "react-native-reanimated";
import { useAccent } from "@/settings";
import { color } from "@/theme";
import { type } from "@/type";
import { Avatar } from "./Avatar";

type Props = {
  value: string;
  onChange: (text: string) => void;
  onSubmit: () => void;
  /** What was searched for, so the part of each handle already typed can be marked. */
  query: string;
  actors: Actor[];
  onPick: (actor: Actor) => void;
  /** The handle a sign-in is running for; its row shows the wait and the rest hold still. */
  pending: string | null;
};

/** The typed part of a handle in ink, the rest quiet: the eye lands on what tells two matches apart. */
function Handle({ handle, query }: { handle: string; query: string }) {
  const typed = query.length > 0 && handle.startsWith(query) ? query.length : 0;
  return (
    <Text style={[type.meta, { color: color.muted }]} numberOfLines={1}>
      @<Text style={{ color: color.ink }}>{handle.slice(0, typed)}</Text>
      {handle.slice(typed)}
    </Text>
  );
}

/**
 * One field for a handle or a DID, with the people it might mean listed in a card joined to it. The field stays where
 * it is as suggestions come and go: the card grows downward, so nothing moves under the finger.
 */
export function HandleField({ value, onChange, onSubmit, query, actors, onPick, pending }: Props) {
  const { accent } = useAccent();
  const busy = pending !== null;
  return (
    <Animated.View layout={LinearTransition.duration(160)} style={styles.card}>
      <View style={styles.field}>
        <SymbolView name="at" size={18} tintColor={color.muted} />
        <TextInput
          style={[type.body, styles.input]}
          value={value}
          onChangeText={onChange}
          onSubmitEditing={onSubmit}
          editable={!busy}
          placeholder="you.example.com"
          placeholderTextColor={color.muted}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="off"
          spellCheck={false}
          textContentType="none"
          keyboardType="url"
          returnKeyType="go"
          clearButtonMode="while-editing"
          autoFocus
          accessibilityLabel="atmosphere account"
          accessibilityHint="your handle from Bluesky or Blacksky"
        />
      </View>
      {actors.map((actor) => {
        const waiting = pending === actor.handle;
        return (
          <Animated.View key={actor.did} entering={FadeIn.duration(140)}>
            <Pressable
              onPress={() => onPick(actor)}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel={`sign in as ${actor.handle}`}
              accessibilityState={{ busy: waiting, disabled: busy }}
              style={({ pressed }) => [styles.row, pressed && styles.pressed, busy && !waiting && styles.held]}
            >
              <Avatar url={actor.avatar} size={40} />
              <View style={styles.text}>
                <Text style={[type.row, { color: color.ink }]} numberOfLines={1}>
                  {actor.displayName?.trim() || actor.handle}
                </Text>
                <Handle handle={actor.handle} query={query} />
              </View>
              {waiting ? <ActivityIndicator color={accent} /> : <SymbolView name="arrow.right.circle.fill" size={22} tintColor={accent} />}
            </Pressable>
          </Animated.View>
        );
      })}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: color.surface,
    borderRadius: 22,
    borderCurve: "continuous",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.border,
    overflow: "hidden",
  },
  field: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    height: 52,
    paddingHorizontal: 16,
  },
  input: { flex: 1, height: 52, color: color.ink },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: 60,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: color.border,
  },
  text: { flex: 1, gap: 1 },
  pressed: { backgroundColor: color.fill },
  held: { opacity: 0.4 },
});
