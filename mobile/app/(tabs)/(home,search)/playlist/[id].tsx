import { useLocalSearchParams } from "expo-router";
import { count } from "plyr-shared/format";
import { CollectionHeader } from "@/components/CollectionHeader";
import { TrackListScreen } from "@/components/TrackListScreen";
import { usePlaylist } from "@/data";

export default function PlaylistScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const playlist = usePlaylist(id);
  const meta = playlist.data?.playlist;
  const tracks = playlist.data?.tracks ?? [];
  return (
    <TrackListScreen
      title={meta?.name ?? ""}
      header={
        meta ? (
          <CollectionHeader
            cover={meta.image_url}
            title={meta.name}
            owner={{ label: `@${meta.owner_handle}`, handle: meta.owner_handle }}
            meta={count(meta.track_count, "track")}
            tracks={tracks}
          />
        ) : null
      }
      tracks={tracks}
      label={meta?.name}
      pending={playlist.isPending}
      error={playlist.isError}
      empty="this playlist is empty."
      refreshing={playlist.isRefetching}
      onRefresh={() => void playlist.refetch()}
    />
  );
}
