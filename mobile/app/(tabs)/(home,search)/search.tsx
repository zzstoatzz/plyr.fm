import { useQueryClient } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from "react-native";
import { TrackRow } from "@/components/TrackRow";
import { fetchTrack, useTrackSearch } from "@/data";
import { usePlayer } from "@/player/PlayerProvider";
import { color } from "@/theme";
import { type } from "@/type";

function useDebounced<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}

export default function Search() {
  const [text, setText] = useState("");
  const query = useDebounced(text, 250);
  const search = useTrackSearch(query);
  const client = useQueryClient();
  const player = usePlayer();
  const results = search.data ?? [];
  const short = query.trim().length < 2;

  // search results carry no audio details, so the tapped track is fetched whole before it plays
  const play = async (id: number) => {
    const track = await fetchTrack(client, id).catch(() => null);
    if (track) player.playList([track], 0);
  };

  return (
    <>
      <Stack.Screen
        options={{
          title: "search",
          headerSearchBarOptions: {
            placeholder: "tracks, artists",
            autoCapitalize: "none",
            hideWhenScrolling: false,
            onChangeText: (e) => setText(e.nativeEvent.text),
          },
        }}
      />
      <FlatList
        contentInsetAdjustmentBehavior="automatic"
        keyboardDismissMode="on-drag"
        data={short ? [] : results}
        keyExtractor={(r) => String(r.id)}
        renderItem={({ item }) => (
          <TrackRow
            title={item.title}
            artist={item.artist_display_name}
            artwork={item.image_url}
            active={player.track?.id === item.id}
            onPress={() => void play(item.id)}
          />
        )}
        ListEmptyComponent={
          short ? null : search.isPending ? (
            <ActivityIndicator style={styles.state} color={color.muted} />
          ) : (
            <View style={styles.state}>
              <Text style={[type.body, { color: color.muted, textAlign: "center" }]}>
                {search.isError ? "search didn’t go through. try again." : `nothing matches “${query.trim()}”.`}
              </Text>
            </View>
          )
        }
      />
    </>
  );
}

const styles = StyleSheet.create({
  state: { padding: 40 },
});
