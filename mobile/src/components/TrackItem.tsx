import type { Track } from "plyr-shared/contract";
import { count, credits } from "plyr-shared/format";
import { trackThumbnailUrl } from "plyr-shared/images";
import { listeningLabel } from "plyr-shared/playback";
import { useOpen } from "@/nav";
import { usePlayer } from "@/player/PlayerProvider";
import { TrackRow } from "./TrackRow";

/** What sits under the title: who made it, or, where the screen already says who, its album or its plays. */
export type TrackLine = "artist" | "album" | "plays";

type Props = { tracks: readonly Track[]; index: number; line?: TrackLine };

/** A track in a list: tapping plays the list from here, the artist line opens the artist. */
export function TrackItem({ tracks, index, line = "artist" }: Props) {
  const player = usePlayer();
  const open = useOpen();
  const track = tracks[index];
  return (
    <TrackRow
      title={track.title}
      artist={line === "artist" ? credits(track) : (line === "album" && track.album?.title) || count(track.play_count, "play")}
      artwork={trackThumbnailUrl(track)}
      active={player.track?.id === track.id}
      locked={track.gated ? listeningLabel(track.publishing?.access.listening) : null}
      onPress={() => player.playList(tracks, index)}
      onArtist={line === "artist" ? () => open({ artist: track.artist_handle }) : undefined}
    />
  );
}
