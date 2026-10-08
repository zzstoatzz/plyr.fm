import { useLocalSearchParams } from "expo-router";
import { count } from "plyr-shared/format";
import { IMAGE_WIDTHS } from "plyr-shared/images";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Artwork } from "@/components/Artwork";
import { TrackListScreen } from "@/components/TrackListScreen";
import { usePlaylist } from "@/data";
import { useOpen } from "@/nav";
import { color, inset, radius } from "@/theme";
import { type } from "@/type";

const COVER = 180;

export default function PlaylistScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const playlist = usePlaylist(id);
  const open = useOpen();
  const meta = playlist.data?.playlist;

  const header = meta ? (
    <View style={styles.header}>
      <Artwork url={meta.image_url} size={COVER} width={IMAGE_WIDTHS.hero} radius={radius.hero} />
      <Text style={[type.title, { color: color.ink, textAlign: "center" }]} accessibilityRole="header">
        {meta.name}
      </Text>
      <Pressable onPress={() => open({ artist: meta.owner_handle })} accessibilityRole="link" accessibilityHint="opens the owner" hitSlop={8}>
        <Text style={[type.secondary, { color: color.accent }]}>@{meta.owner_handle}</Text>
      </Pressable>
      <Text style={[type.meta, { color: color.muted }]}>{count(meta.track_count, "track")}</Text>
    </View>
  ) : null;

  return (
    <TrackListScreen
      title={meta?.name ?? ""}
      header={header}
      tracks={playlist.data?.tracks ?? []}
      pending={playlist.isPending}
      error={playlist.isError}
      empty="this playlist is empty."
      refreshing={playlist.isRefetching}
      onRefresh={() => void playlist.refetch()}
    />
  );
}

const styles = StyleSheet.create({
  header: { alignItems: "center", gap: 4, paddingHorizontal: inset, paddingTop: 8, paddingBottom: 12 },
});
