import { Link } from "expo-router";
import type { Track } from "plyr-shared/contract";
import { count, credits } from "plyr-shared/format";
import { trackThumbnailUrl } from "plyr-shared/images";
import { listeningLabel } from "plyr-shared/playback";
import { playsThroughCollections } from "plyr-shared/settings";
import { haptic } from "@/haptics";
import { useOpen } from "@/nav";
import { canPlay, usePlayer } from "@/player/PlayerProvider";
import { showQueueBanner } from "@/queueBanner";
import { useSettings } from "@/settings";
import { TrackRow } from "./TrackRow";

/** What sits under the title: who made it, or, where the screen already says who, its album or its plays. */
export type TrackLine = "artist" | "album" | "plays";

type Props = {
  tracks: readonly Track[];
  index: number;
  line?: TrackLine;
  label?: string | null;
  /** The list is an album or a playlist: whether a tap plays on through it is the listener's setting, as on the web. */
  collection?: boolean;
};

/** A track in a list: tapping plays the list from here as "next from: label"; holding offers the queue and where it came from. */
export function TrackItem({ tracks, index, line = "artist", label = null, collection = false }: Props) {
  const player = usePlayer();
  const settings = useSettings();
  const alone = collection && !playsThroughCollections(settings);
  const open = useOpen();
  const track = tracks[index];
  const album = track.album;
  const playable = canPlay(track);
  return (
    <Link href={{ pathname: "/artist/[handle]", params: { handle: track.artist_handle } }} asChild>
      <Link.Trigger>
        <TrackRow
          title={track.title}
          artist={line === "artist" ? credits(track) : (line === "album" && album?.title) || count(track.play_count, "play")}
          artwork={trackThumbnailUrl(track)}
          active={player.track?.id === track.id}
          locked={track.gated ? listeningLabel(track.publishing?.access.listening) : null}
          onPlay={() => (alone ? player.playList([track], 0) : player.playList(tracks, index, label))}
          onArtist={line === "artist" ? () => open({ artist: track.artist_handle }) : undefined}
        />
      </Link.Trigger>
      <Link.Menu>
        {playable ? (
          <Link.MenuAction
            title="play next"
            icon="text.line.first.and.arrowtriangle.forward"
            onPress={() => {
              player.playNext(track);
              haptic.success();
              showQueueBanner(`queued ${track.title}`, "text.line.first.and.arrowtriangle.forward");
            }}
          />
        ) : null}
        {playable ? (
          <Link.MenuAction
            title="add to queue"
            icon="text.line.last.and.arrowtriangle.forward"
            onPress={() => {
              player.addToQueue(track);
              haptic.success();
              showQueueBanner(`queued ${track.title}`, "text.line.last.and.arrowtriangle.forward");
            }}
          />
        ) : null}
        <Link.MenuAction title="go to artist" icon="person" onPress={() => open({ artist: track.artist_handle })} />
        {album ? <Link.MenuAction title="go to album" icon="square.stack" onPress={() => open({ album: { handle: track.artist_handle, slug: album.slug } })} /> : null}
      </Link.Menu>
    </Link>
  );
}
