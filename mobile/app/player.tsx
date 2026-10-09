import { Host, Slider } from "@expo/ui/swift-ui";
import { credits, formatTime } from "plyr-shared/format";
import { IMAGE_WIDTHS, trackCoverUrl } from "plyr-shared/images";
import { upNext } from "plyr-shared/queue";
import { richText } from "plyr-shared/richtext";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Linking, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Artwork } from "@/components/Artwork";
import { PlayPause, TransportButton } from "@/components/Transport";
import { useOpen, type Target } from "@/nav";
import { usePlayer, useProgress } from "@/player/PlayerProvider";
import { color, inset, radius } from "@/theme";
import { type } from "@/type";

export default function Player() {
  const { track, queue, repeat, status, canNext, next, previous, seek, toggleRepeat } = usePlayer();
  const { position, duration } = useProgress();
  const { width } = useWindowDimensions();
  const [scrub, setScrub] = useState<number | null>(null);
  const [more, setMore] = useState(false);
  const router = useRouter();
  const open = useOpen();
  if (!track) return null;

  // the sheet sits over the tabs, so it steps aside before the tab underneath pushes the page
  const leaveFor = (target: Target) => {
    router.dismiss();
    requestAnimationFrame(() => open(target));
  };

  const shown = scrub ?? position;
  const art = Math.min(width - inset * 2, 360);
  const album = track.album;

  const about = track.description?.trim();
  const queued = upNext(queue).length;

  return (
    <SafeAreaView style={styles.fill} edges={["bottom"]}>
      <ScrollView contentContainerStyle={styles.screen} alwaysBounceVertical={false}>
        <View style={styles.art}>
          <Artwork url={trackCoverUrl(track)} size={art} width={IMAGE_WIDTHS.hero} radius={radius.hero} />
        </View>
        <View style={styles.meta}>
          <Text style={[type.title, { color: color.ink }]} numberOfLines={2} accessibilityRole="header">
            {track.title}
          </Text>
          <Pressable onPress={() => leaveFor({ artist: track.artist_handle })} accessibilityRole="link" accessibilityHint="opens the artist" hitSlop={8} style={styles.link}>
            {({ pressed }) => (
              <Text style={[type.body, { color: color.accent, opacity: pressed ? 0.6 : 1 }]} numberOfLines={1}>
                {credits(track)}
              </Text>
            )}
          </Pressable>
          {album ? (
            <Pressable
              onPress={() => leaveFor({ album: { handle: track.artist_handle, slug: album.slug } })}
              accessibilityRole="link"
              accessibilityHint="opens the album"
              hitSlop={8}
              style={styles.link}
            >
              {({ pressed }) => (
                <Text style={[type.meta, { color: color.accent, opacity: pressed ? 0.6 : 1 }]} numberOfLines={1}>
                  {album.title}
                </Text>
              )}
            </Pressable>
          ) : null}
        </View>
        <View>
          <Host matchContents={{ vertical: true }} seedColor={color.accent} style={styles.slider}>
            <Slider
              value={duration > 0 ? shown : 0}
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
        <View style={styles.controls}>
          <TransportButton
            symbol={repeat === "one" ? "repeat.1" : "repeat"}
            label="repeat this track"
            size={20}
            tint={repeat === "one" ? color.accent : color.muted}
            selected={repeat === "one"}
            onPress={toggleRepeat}
          />
          <TransportButton
            symbol="list.bullet"
            label={queued ? `queue, ${queued} up next` : "queue"}
            size={20}
            tint={color.muted}
            onPress={() => router.push("/queue")}
          />
        </View>
        {about ? (
          <Pressable onPress={() => setMore((open) => !open)} accessibilityRole="button" accessibilityHint={more ? "shows less" : "shows all of it"} style={styles.about}>
            <Text style={[type.secondary, { color: color.muted }]} numberOfLines={more ? undefined : 3}>
              {richText(about).map((part, i) =>
                part.type === "link" ? (
                  <Text key={i} style={{ color: color.accent }} accessibilityRole="link" onPress={() => void Linking.openURL(part.href)}>
                    {part.content}
                  </Text>
                ) : (
                  part.content
                ),
              )}
            </Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  screen: { paddingHorizontal: inset, paddingTop: 48, paddingBottom: 24, gap: 24 },
  about: { paddingTop: 4 },
  art: { alignItems: "center" },
  meta: { gap: 4 },
  link: { alignSelf: "flex-start", maxWidth: "100%" },
  slider: { height: 32 },
  times: { flexDirection: "row", justifyContent: "space-between" },
  controls: { flexDirection: "row", alignItems: "center", justifyContent: "space-evenly" },
});
