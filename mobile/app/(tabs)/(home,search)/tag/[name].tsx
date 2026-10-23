import { useLocalSearchParams } from "expo-router";
import { count } from "plyr-shared/format";
import { StyleSheet, Text } from "react-native";
import { TrackListScreen } from "@/components/TrackListScreen";
import { useTagTracks } from "@/data";
import { color, inset } from "@/theme";
import { type } from "@/type";

export default function TagScreen() {
  const { name } = useLocalSearchParams<{ name: string }>();
  const tag = useTagTracks(name);
  return (
    <TrackListScreen
      title={`#${name}`}
      header={tag.data ? <Text style={[type.secondary, styles.count]}>{count(tag.data.tag.track_count, "track")}</Text> : null}
      tracks={tag.data?.tracks ?? []}
      label={`#${name}`}
      pending={tag.isPending}
      error={tag.isError}
      empty="no tracks with this tag."
      refreshing={tag.isRefetching}
      onRefresh={() => void tag.refetch()}
    />
  );
}

const styles = StyleSheet.create({
  count: { color: color.muted, paddingHorizontal: inset, paddingBottom: 8 },
});
