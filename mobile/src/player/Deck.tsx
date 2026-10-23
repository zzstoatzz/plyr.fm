import { memo, useEffect, useMemo } from "react";
import { Audio, useAudioTagContext, type AudioContext, type AudioTagHandle } from "react-native-audio-api";

export type DeckEvent =
  | { trackId: number; kind: "ready" | "play" | "pause" | "waiting" | "playing" | "ended" | "error" | "gone" }
  | { trackId: number; kind: "position" | "duration"; seconds: number }
  | { trackId: number; kind: "handle"; handle: AudioTagHandle };

type Props = { trackId: number; uri: string; context: AudioContext; on: (event: DeckEvent) => void };

/** One track's decoder. It never starts itself: the provider plays whichever deck is current, so the next one can sit opened. */
export const Deck = memo(function Deck({ trackId, uri, context, on }: Props) {
  const source = useMemo(() => ({ uri }), [uri]);
  useEffect(() => () => on({ trackId, kind: "gone" }), [trackId, on]);
  return (
    <Audio
      ref={(handle) => {
        if (handle) on({ trackId, kind: "handle", handle });
      }}
      source={source}
      context={context}
      onLoad={() => on({ trackId, kind: "ready" })}
      onPlay={() => on({ trackId, kind: "play" })}
      onPause={() => on({ trackId, kind: "pause" })}
      onWaiting={() => on({ trackId, kind: "waiting" })}
      onPlaying={() => on({ trackId, kind: "playing" })}
      onEnded={() => on({ trackId, kind: "ended" })}
      onError={() => on({ trackId, kind: "error" })}
      onPositionChange={(seconds) => on({ trackId, kind: "position", seconds })}
    >
      <Duration trackId={trackId} on={on} />
    </Audio>
  );
});

/** The tag only exposes duration through its context, so a child reads it out. */
function Duration({ trackId, on }: Pick<Props, "trackId" | "on">) {
  const { duration } = useAudioTagContext();
  useEffect(() => {
    if (duration > 0) on({ trackId, kind: "duration", seconds: duration });
  }, [duration, trackId, on]);
  return null;
}
