import { useRouter } from "expo-router";
import { NativeTabs } from "expo-router/unstable-native-tabs";
import { credits } from "plyr-shared/format";
import { IMAGE_WIDTHS, trackThumbnailUrl } from "plyr-shared/images";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { usePlayer } from "@/player/PlayerProvider";
import { color } from "@/theme";
import { type } from "@/type";
import { Artwork } from "./Artwork";
import { PlayPause, TransportButton } from "./Transport";

/** The tab bar's bottom accessory: what is playing, with play/pause; tapping opens the player. */
export function MiniPlayer() {
  const placement = NativeTabs.BottomAccessory.usePlacement();
  const router = useRouter();
  const { track, canNext, next } = usePlayer();
  if (!track) return null;
  const inline = placement === "inline";
  return (
    <View style={styles.bar}>
      <Pressable
        style={styles.open}
        onPress={() => router.push("/player")}
        accessibilityRole="button"
        accessibilityLabel={`now playing: ${track.title}, by ${credits(track)}`}
        accessibilityHint="opens the player"
      >
        <Artwork url={trackThumbnailUrl(track)} size={inline ? 28 : 36} width={IMAGE_WIDTHS.thumb} radius={6} />
        <View style={styles.text}>
          <Text style={[type.secondary, { color: color.ink, fontWeight: "600" }]} numberOfLines={1}>
            {track.title}
          </Text>
          {inline ? null : (
            <Text style={[type.meta, { color: color.muted }]} numberOfLines={1}>
              {credits(track)}
            </Text>
          )}
        </View>
      </Pressable>
      <PlayPause size={20} />
      {inline ? null : <TransportButton symbol="forward.fill" label="next track" size={20} disabled={!canNext} onPress={next} />}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flex: 1, flexDirection: "row", alignItems: "center", paddingLeft: 12, paddingRight: 8, gap: 4 },
  open: { flex: 1, flexDirection: "row", alignItems: "center", gap: 10, minHeight: 44 },
  text: { flex: 1 },
});
