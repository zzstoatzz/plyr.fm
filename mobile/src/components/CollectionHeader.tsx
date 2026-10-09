import type { Track } from "plyr-shared/contract";
import { IMAGE_WIDTHS } from "plyr-shared/images";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useOpen } from "@/nav";
import { canPlay, usePlayer } from "@/player/PlayerProvider";
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

/** The top of an album or a playlist: cover, name, whose it is, and play. */
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
          <Button label="play" symbol="play.fill" onPress={() => player.playList(tracks, 0)} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { alignItems: "center", gap: 4, paddingHorizontal: inset, paddingTop: 8, paddingBottom: 12 },
  title: { color: color.ink, textAlign: "center", marginTop: 8 },
  description: { color: color.muted, textAlign: "center", marginTop: 6 },
  actions: { marginTop: 12 },
});
