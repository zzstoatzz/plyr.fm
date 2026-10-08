import { Image } from "expo-image";
import { useLocalSearchParams } from "expo-router";
import { SymbolView } from "expo-symbols";
import { resizedImageUrl } from "plyr-shared/images";
import { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { TrackListScreen } from "@/components/TrackListScreen";
import { useArtist, useArtistTracks } from "@/data";
import { canPlay, usePlayer } from "@/player/PlayerProvider";
import { color, inset } from "@/theme";
import { type } from "@/type";

const AVATAR = 88;

export default function ArtistScreen() {
  const { handle } = useLocalSearchParams<{ handle: string }>();
  const artist = useArtist(handle);
  const pages = useArtistTracks(artist.data?.did);
  const player = usePlayer();
  const tracks = useMemo(() => pages.data?.pages.flatMap((p) => p.tracks) ?? [], [pages.data]);
  const playable = tracks.some(canPlay);
  const avatar = resizedImageUrl(artist.data?.avatar_url ?? null, AVATAR * 3);

  const header = artist.data ? (
    <View style={styles.header}>
      {avatar ? (
        <Image source={avatar} style={styles.avatar} contentFit="cover" transition={120} accessibilityIgnoresInvertColors />
      ) : (
        <View style={[styles.avatar, styles.blank]}>
          <SymbolView name="person.fill" size={36} tintColor={color.muted} />
        </View>
      )}
      <Text style={[type.title, { color: color.ink, textAlign: "center" }]} accessibilityRole="header">
        {artist.data.display_name}
      </Text>
      <Text style={[type.secondary, { color: color.muted }]}>@{artist.data.handle}</Text>
      {artist.data.bio ? <Text style={[type.secondary, styles.bio]}>{artist.data.bio}</Text> : null}
      {playable ? (
        <Pressable
          onPress={() => player.playList(tracks, 0)}
          accessibilityRole="button"
          accessibilityLabel={`play ${artist.data.display_name}`}
          style={({ pressed }) => [styles.play, pressed && { opacity: 0.7 }]}
        >
          <SymbolView name="play.fill" size={14} tintColor={color.onAccent} />
          <Text style={[type.secondary, { color: color.onAccent, fontWeight: "600" }]}>play</Text>
        </Pressable>
      ) : null}
      {tracks.length > 0 ? (
        <Text style={[type.section, styles.section]} accessibilityRole="header">
          tracks
        </Text>
      ) : null}
    </View>
  ) : null;

  return (
    <TrackListScreen
      title={artist.data?.display_name ?? ""}
      header={header}
      tracks={tracks}
      showArtist={false}
      pending={artist.isPending || (!!artist.data && pages.isPending)}
      error={artist.isError || pages.isError}
      empty={artist.isError ? "" : "no tracks yet."}
      refreshing={pages.isRefetching && !pages.isFetchingNextPage}
      onRefresh={() => {
        void artist.refetch();
        void pages.refetch();
      }}
      onEndReached={() => pages.hasNextPage && !pages.isFetchingNextPage && void pages.fetchNextPage()}
      loadingMore={pages.isFetchingNextPage}
    />
  );
}

const styles = StyleSheet.create({
  header: { alignItems: "center", gap: 4, paddingHorizontal: inset, paddingTop: 8 },
  avatar: { width: AVATAR, height: AVATAR, borderRadius: AVATAR / 2, backgroundColor: color.fill, marginBottom: 8 },
  blank: { alignItems: "center", justifyContent: "center" },
  bio: { color: color.muted, textAlign: "center", marginTop: 6 },
  play: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: color.accent,
    borderRadius: 22,
    minHeight: 44,
    paddingHorizontal: 22,
    marginTop: 14,
  },
  section: { color: color.ink, alignSelf: "stretch", paddingTop: 20, paddingBottom: 4 },
});
