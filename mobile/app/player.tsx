import { credits, formatTime } from "plyr-shared/format";
import { IMAGE_WIDTHS, trackCoverUrl } from "plyr-shared/images";
import { upNext } from "plyr-shared/queue";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Artwork } from "@/components/Artwork";
import { Scrubber } from "@/components/Scrubber";
import { TopEdge } from "@/components/TopEdge";
import { SleepButton } from "@/components/SleepButton";
import { PlayPause, TransportButton } from "@/components/Transport";
import { useOpen, type Target } from "@/nav";
import { usePlayer, useProgress } from "@/player/PlayerProvider";
import { color, inset, radius } from "@/theme";
import { type } from "@/type";
import { RoutePicker } from "../modules/route-picker";
import { SheetGuard } from "../modules/sheet-guard";

export default function Player() {
  const { track, queue, repeat, status, canNext, next, previous, seek, toggleRepeat } = usePlayer();
  const { position, duration } = useProgress();
  const { width } = useWindowDimensions();
  const [scrub, setScrub] = useState<number | null>(null);
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

  const described = !!track.description?.trim();
  const playing = status === "playing" || status === "buffering";
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
        <SheetGuard style={styles.guarded}>
          <View>
            <Scrubber
              value={duration > 0 ? shown : 0}
              max={duration}
              label="position"
              valueText={`${formatTime(shown)} of ${formatTime(duration)}`}
              onChange={setScrub}
              onCommit={(seconds) => {
                seek(seconds);
                setScrub(null);
              }}
            />
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
              label={repeat === "one" ? "stop repeating" : "repeat this track"}
              size={20}
              tint={repeat === "one" ? color.accent : color.muted}
              selected={repeat === "one"}
              onPress={toggleRepeat}
            />
            <RoutePicker tint={color.muted} activeTint={color.accent} style={styles.route} />
            <TransportButton
              symbol="list.bullet"
              label={queued ? `queue, ${queued} up next` : "queue"}
              size={20}
              tint={color.muted}
              onPress={() => router.push("/queue")}
            />
            <SleepButton />
            {described ? <TransportButton symbol="info.circle" label="about this track" size={20} tint={color.muted} onPress={() => router.push("/about")} /> : null}
          </View>
        </SheetGuard>
      </ScrollView>
      <TopEdge lit={playing} radius={radius.sheet} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  screen: { paddingHorizontal: inset, paddingTop: 48, paddingBottom: 24, gap: 24 },
  guarded: { gap: 24 },
  art: { alignItems: "center" },
  meta: { gap: 4 },
  link: { alignSelf: "flex-start", maxWidth: "100%", minHeight: 28, justifyContent: "center" },
  route: { width: 44, height: 44 },
  times: { flexDirection: "row", justifyContent: "space-between", marginTop: -8 },
  controls: { flexDirection: "row", alignItems: "center", justifyContent: "space-evenly" },
});
