import { Host, Slider } from "@expo/ui/swift-ui";
import { credits, formatTime } from "plyr-shared/format";
import { IMAGE_WIDTHS, trackCoverUrl } from "plyr-shared/images";
import { useState } from "react";
import { StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Artwork } from "@/components/Artwork";
import { PlayPause, TransportButton } from "@/components/Transport";
import { usePlayer, useProgress } from "@/player/PlayerProvider";
import { color, inset, radius } from "@/theme";
import { type } from "@/type";

export default function Player() {
  const { track, status, canNext, next, previous, seek } = usePlayer();
  const { position, duration } = useProgress();
  const { width } = useWindowDimensions();
  const [scrub, setScrub] = useState<number | null>(null);
  if (!track) return null;

  const shown = scrub ?? position;
  const art = Math.min(width - inset * 2, 360);

  return (
    <SafeAreaView style={styles.screen} edges={["bottom"]}>
      <View style={styles.art}>
        <Artwork url={trackCoverUrl(track)} size={art} width={IMAGE_WIDTHS.hero} radius={radius.hero} />
      </View>
      <View style={styles.meta}>
        <Text style={[type.title, { color: color.ink }]} numberOfLines={2} accessibilityRole="header">
          {track.title}
        </Text>
        <Text style={[type.body, { color: color.muted }]} numberOfLines={1}>
          {credits(track)}
        </Text>
        {track.album ? (
          <Text style={[type.meta, { color: color.muted }]} numberOfLines={1}>
            {track.album.title}
          </Text>
        ) : null}
      </View>
      <View>
        <Host matchContents={{ vertical: true }} seedColor={color.accent} style={styles.slider}>
          <Slider
            value={shown}
            min={0}
            max={Math.max(duration, 1)}
            onValueChange={setScrub}
            onEditingChanged={(editing) => {
              if (!editing && scrub !== null) {
                seek(scrub);
                setScrub(null);
              }
            }}
          />
        </Host>
        <View style={styles.times}>
          <Text style={[type.meta, type.numeric, { color: color.muted }]}>{formatTime(shown)}</Text>
          <Text style={[type.meta, { color: status === "failed" ? color.danger : color.muted }]}>
            {status === "failed" ? "couldn’t play this track" : status === "buffering" ? "buffering" : ""}
          </Text>
          <Text style={[type.meta, type.numeric, { color: color.muted }]}>-{formatTime(Math.max(duration - shown, 0))}</Text>
        </View>
      </View>
      <View style={styles.controls}>
        <TransportButton symbol="backward.fill" label="previous track" size={30} onPress={previous} />
        <PlayPause size={44} />
        <TransportButton symbol="forward.fill" label="next track" size={30} disabled={!canNext} onPress={next} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, paddingHorizontal: inset, paddingTop: 48, gap: 24 },
  art: { alignItems: "center" },
  meta: { gap: 4 },
  slider: { height: 32 },
  times: { flexDirection: "row", justifyContent: "space-between" },
  controls: { flexDirection: "row", alignItems: "center", justifyContent: "space-evenly" },
});
