import { Image } from "expo-image";
import { useLocalSearchParams } from "expo-router";
import { SymbolView } from "expo-symbols";
import { count } from "plyr-shared/format";
import { resizedImageUrl } from "plyr-shared/images";
import { supportUrl } from "plyr-shared/support";
import { useMemo } from "react";
import { Linking, StyleSheet, Text, View } from "react-native";
import { AlbumShelf } from "@/components/AlbumShelf";
import { Button } from "@/components/Button";
import { CollectionRow } from "@/components/CollectionRow";
import { TrackListScreen } from "@/components/TrackListScreen";
import { useArtist, useArtistAlbums, useArtistPlaylists, useArtistTracks } from "@/data";
import { useOpen } from "@/nav";
import { canPlay, usePlayer } from "@/player/PlayerProvider";
import { color, inset, radius } from "@/theme";
import { type } from "@/type";

const AVATAR = 88;

export default function ArtistScreen() {
  const { handle } = useLocalSearchParams<{ handle: string }>();
  const artist = useArtist(handle);
  const pages = useArtistTracks(artist.data?.did);
  const albums = useArtistAlbums(handle);
  const playlists = useArtistPlaylists(artist.data?.did);
  const player = usePlayer();
  const open = useOpen();
  const tracks = useMemo(() => pages.data?.pages.flatMap((p) => p.tracks) ?? [], [pages.data]);
  const avatar = resizedImageUrl(artist.data?.avatar_url ?? null, AVATAR * 3);
  const support = artist.data ? supportUrl(artist.data) : null;
  const playable = tracks.some(canPlay);

  const header = artist.data ? (
    <View>
      <View style={styles.profile}>
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
        {playable || support ? (
          <View style={styles.actions}>
            {playable ? <Button label="play" symbol="play.fill" onPress={() => player.playList(tracks, 0, artist.data?.display_name)} /> : null}
            {support ? (
              <Button
                label="support"
                symbol="heart.fill"
                kind="tinted"
                role="link"
                hint="opens in your browser"
                onPress={() => void Linking.openURL(support)}
              />
            ) : null}
          </View>
        ) : null}
      </View>
      {albums.data?.length ? (
        <View style={styles.section}>
          <Heading title="albums" detail={count(albums.data.length, "album")} />
          <AlbumShelf albums={albums.data} onOpen={(album) => open({ album: { handle, slug: album.slug } })} />
        </View>
      ) : null}
      {playlists.data?.length ? (
        <View style={styles.section}>
          <Heading title="collections" />
          <View>
            {playlists.data.map((playlist) => (
              <CollectionRow
                key={playlist.id}
                title={playlist.name}
                detail={count(playlist.track_count, "track")}
                image={playlist.image_url ?? null}
                onPress={() => open({ playlist: playlist.id })}
              />
            ))}
          </View>
        </View>
      ) : null}
      {tracks.length > 0 ? (
        <View style={styles.section}>
          <Heading title="tracks" />
        </View>
      ) : null}
    </View>
  ) : null;

  return (
    <TrackListScreen
      title={artist.data?.display_name ?? ""}
      header={header}
      tracks={tracks}
      line="album"
      label={artist.data?.display_name}
      pending={artist.isPending || (!!artist.data && pages.isPending)}
      error={artist.isError || pages.isError}
      empty={artist.isError ? "" : "no tracks yet."}
      refreshing={pages.isRefetching && !pages.isFetchingNextPage}
      onRefresh={() => {
        void artist.refetch();
        void pages.refetch();
        void albums.refetch();
        void playlists.refetch();
      }}
      onEndReached={() => pages.hasNextPage && !pages.isFetchingNextPage && void pages.fetchNextPage()}
      loadingMore={pages.isFetchingNextPage}
    />
  );
}

function Heading({ title, detail }: { title: string; detail?: string }) {
  return (
    <View style={styles.heading}>
      <Text style={[type.section, { color: color.ink }]} accessibilityRole="header">
        {title}
      </Text>
      {detail ? <Text style={[type.meta, { color: color.muted }]}>{detail}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  profile: {
    alignItems: "center",
    gap: 4,
    marginHorizontal: inset,
    marginTop: 8,
    padding: 24,
    backgroundColor: color.surface,
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.hero,
    borderCurve: "continuous",
  },
  avatar: { width: AVATAR, height: AVATAR, borderRadius: AVATAR / 2, backgroundColor: color.fill, marginBottom: 8, borderWidth: 3, borderColor: color.border },
  blank: { alignItems: "center", justifyContent: "center" },
  bio: { color: color.muted, textAlign: "center", marginTop: 6 },
  actions: { flexDirection: "row", gap: 10, marginTop: 14 },
  section: { paddingTop: 22, gap: 8 },
  heading: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", paddingHorizontal: inset },
});
