import type { Track } from "plyr-shared/contract";
import { count } from "plyr-shared/format";
import { trackThumbnailUrl } from "plyr-shared/images";
import { listeningLabel } from "plyr-shared/playback";
import { useOpen } from "@/nav";
import { usePlayer } from "@/player/PlayerProvider";
import { TrackRow } from "./TrackRow";

/** A track in a list: tapping plays the list from here, the artist line opens the artist. */
export function TrackItem({ tracks, index, showArtist = true }: { tracks: readonly Track[]; index: number; showArtist?: boolean }) {
  const player = usePlayer();
  const open = useOpen();
  const track = tracks[index];
  const credits = [track.artist, ...track.features.map((f) => f.display_name)].join(", ");
  return (
    <TrackRow
      title={track.title}
      artist={showArtist ? credits : track.album?.title ?? count(track.play_count, "play")}
      artwork={trackThumbnailUrl(track)}
      active={player.track?.id === track.id}
      locked={track.gated ? listeningLabel(track.publishing?.access.listening) : null}
      onPress={() => player.playList(tracks, index)}
      onArtist={showArtist ? () => open({ artist: track.artist_handle }) : undefined}
    />
  );
}
