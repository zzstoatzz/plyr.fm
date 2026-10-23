import { useLocalSearchParams } from "expo-router";
import { count } from "plyr-shared/format";
import { CollectionHeader } from "@/components/CollectionHeader";
import { TrackListScreen } from "@/components/TrackListScreen";
import { useAlbum } from "@/data";

export default function AlbumScreen() {
  const { handle, slug } = useLocalSearchParams<{ handle: string; slug: string }>();
  const album = useAlbum(handle, slug);
  const meta = album.data?.album;
  const tracks = album.data?.tracks ?? [];
  return (
    <TrackListScreen
      title={meta?.title ?? ""}
      header={
        meta ? (
          <CollectionHeader
            cover={meta.image_url}
            title={meta.title}
            owner={{ label: meta.artist, handle: meta.artist_handle }}
            meta={`${count(meta.track_count, "track")} · ${count(meta.total_plays, "play")}`}
            description={meta.description}
            tracks={tracks}
          />
        ) : null
      }
      tracks={tracks}
      collection
      line="plays"
      label={meta?.title}
      pending={album.isPending}
      error={album.isError}
      empty="this album is empty."
      refreshing={album.isRefetching}
      onRefresh={() => void album.refetch()}
    />
  );
}
