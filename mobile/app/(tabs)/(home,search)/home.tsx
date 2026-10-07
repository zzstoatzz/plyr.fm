import { Stack } from "expo-router";
import { trackThumbnailUrl } from "plyr-shared/images";
import { listeningLabel } from "plyr-shared/playback";
import { useMemo } from "react";
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, Text, View } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import { TopTracks } from "@/components/TopTracks";
import { TrackRow } from "@/components/TrackRow";
import { useLatestTracks } from "@/data";
import { usePlayer } from "@/player/PlayerProvider";
import { color, inset } from "@/theme";
import { type } from "@/type";

export default function Home() {
  const latest = useLatestTracks();
  const client = useQueryClient();
  const player = usePlayer();
  const tracks = useMemo(() => latest.data?.pages.flatMap((p) => p.tracks) ?? [], [latest.data]);

  const refresh = () => {
    void client.invalidateQueries({ queryKey: ["top"] });
    void latest.refetch();
  };

  return (
    <>
      <Stack.Screen options={{ title: "plyr.fm" }} />
      <FlatList
        contentInsetAdjustmentBehavior="automatic"
        data={tracks}
        keyExtractor={(t) => String(t.id)}
        refreshControl={<RefreshControl refreshing={latest.isRefetching && !latest.isFetchingNextPage} onRefresh={refresh} />}
        onEndReached={() => latest.hasNextPage && !latest.isFetchingNextPage && void latest.fetchNextPage()}
        onEndReachedThreshold={0.6}
        ListHeaderComponent={
          <>
            <TopTracks />
            <Text style={[type.section, styles.heading]} accessibilityRole="header">
              tracks
            </Text>
          </>
        }
        renderItem={({ item, index }) => (
          <TrackRow
            title={item.title}
            artist={item.artist}
            artwork={trackThumbnailUrl(item)}
            active={player.track?.id === item.id}
            locked={item.gated ? listeningLabel(item.publishing?.access.listening) : null}
            onPress={() => player.playList(tracks, index)}
          />
        )}
        ListEmptyComponent={
          latest.isPending ? (
            <ActivityIndicator style={styles.state} color={color.muted} />
          ) : (
            <View style={styles.state}>
              <Text style={[type.body, { color: color.muted, textAlign: "center" }]}>
                {latest.isError ? "couldn’t reach plyr.fm. pull to try again." : "no tracks yet."}
              </Text>
            </View>
          )
        }
        ListFooterComponent={latest.isFetchingNextPage ? <ActivityIndicator style={styles.more} color={color.muted} /> : null}
      />
    </>
  );
}

const styles = StyleSheet.create({
  heading: { color: color.ink, paddingHorizontal: inset, paddingTop: 8, paddingBottom: 4 },
  state: { padding: 40 },
  more: { padding: 20 },
});
