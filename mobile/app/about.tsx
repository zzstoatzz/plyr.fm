import { Stack, useRouter } from "expo-router";
import { credits } from "plyr-shared/format";
import { richText } from "plyr-shared/richtext";
import { Linking, Pressable, ScrollView, StyleSheet, Text } from "react-native";
import { usePlayer } from "@/player/PlayerProvider";
import { color, inset } from "@/theme";
import { type } from "@/type";
import { useAccent } from "@/settings";

/** What the artist wrote about the track that is playing, opened from the player's info button. */
export default function About() {
  const { accent } = useAccent();
  const { track } = usePlayer();
  const router = useRouter();
  const about = track?.description?.trim();

  return (
    <>
      <Stack.Screen
        options={{
          title: "about",
          headerRight: () => (
            <Pressable onPress={() => router.dismiss()} accessibilityRole="button" hitSlop={12}>
              <Text style={[type.body, type.strong, { color: accent }]}>done</Text>
            </Pressable>
          ),
        }}
      />
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.screen}>
        {track ? (
          <>
            <Text style={[type.row, { color: color.ink }]} accessibilityRole="header">
              {track.title}
            </Text>
            <Text style={[type.meta, { color: color.muted }]}>{credits(track)}</Text>
          </>
        ) : null}
        <Text style={[type.body, styles.words, { color: color.ink }]} selectable>
          {about
            ? richText(about).map((part, i) =>
                part.type === "link" ? (
                  <Text key={i} style={{ color: accent }} accessibilityRole="link" onPress={() => void Linking.openURL(part.href)}>
                    {part.content}
                  </Text>
                ) : (
                  part.content
                ),
              )
            : "no description"}
        </Text>
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  screen: { paddingHorizontal: inset, paddingTop: 16, paddingBottom: 32, gap: 2 },
  words: { marginTop: 14 },
});
