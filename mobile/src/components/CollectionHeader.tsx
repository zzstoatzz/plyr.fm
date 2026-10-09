import type { Track } from "plyr-shared/contract";
import { IMAGE_WIDTHS } from "plyr-shared/images";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { haptic } from "@/haptics";
import { useOpen } from "@/nav";
import { canPlay, usePlayer } from "@/player/PlayerProvider";
import { showQueueBanner } from "@/queueBanner";
import { color, inset, radius } from "@/theme";
import { type } from "@/type";
import { Artwork } from "./Artwork";
import { Button } from "./Button";

const COVER = 180;

type Props = {
  cover: string | null;
  title: string;
  /** Who it belongs to, shown as written here and opening their page. */
  owner: { label: string; handle: string };
  meta: string;
  description?: string | null;
  tracks: readonly Track[];
};

/** The top of an album or a playlist: cover, name, whose it is, play, and add to queue as the web offers it. */
export function CollectionHeader({ cover, title, owner, meta, description, tracks }: Props) {
  const open = useOpen();
  const player = usePlayer();
  return (
    <View style={styles.header}>
      <Artwork url={cover} size={COVER} width={IMAGE_WIDTHS.hero} radius={radius.hero} />
      <Text style={[type.title, styles.title]} accessibilityRole="header">
        {title}
      </Text>
      <Pressable onPress={() => open({ artist: owner.handle })} accessibilityRole="link" accessibilityHint="opens their page" hitSlop={8}>
        <Text style={[type.secondary, { color: color.accent }]}>{owner.label}</Text>
      </Pressable>
      <Text style={[type.meta, { color: color.muted }]}>{meta}</Text>
      {description ? <Text style={[type.secondary, styles.description]}>{description}</Text> : null}
      {tracks.some(canPlay) ? (
        <View style={styles.actions}>
          <Button label="play" symbol="play.fill" onPress={() => player.playList(tracks, 0, title)} />
          <Button
            label="add to queue"
            symbol="text.line.last.and.arrowtriangle.forward"
            kind="tinted"
            onPress={() => {
              if (player.queueAll(tracks) === 0) return;
              haptic.success();
              showQueueBanner(`added ${title} to queue`, "text.line.last.and.arrowtriangle.forward");
            }}
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { alignItems: "center", gap: 4, paddingHorizontal: inset, paddingTop: 8, paddingBottom: 12 },
  title: { color: color.ink, textAlign: "center", marginTop: 8 },
  description: { color: color.muted, textAlign: "center", marginTop: 6 },
  actions: { marginTop: 12, flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 10 },
});
