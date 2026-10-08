import { useRouter, useSegments } from "expo-router";
import { useCallback } from "react";

type Tab = "(home)" | "(search)";

/** Detail screens push inside whichever tab is showing, so back returns where you were. */
export function useOpen() {
  const router = useRouter();
  const segments = useSegments() as string[];
  const tab: Tab = segments.includes("(search)") ? "(search)" : "(home)";
  return useCallback(
    (target: { artist: string } | { tag: string } | { playlist: string }) => {
      if ("artist" in target) router.push({ pathname: `/(tabs)/${tab}/artist/[handle]`, params: { handle: target.artist } });
      else if ("tag" in target) router.push({ pathname: `/(tabs)/${tab}/tag/[name]`, params: { name: target.tag } });
      else router.push({ pathname: `/(tabs)/${tab}/playlist/[id]`, params: { id: target.playlist } });
    },
    [router, tab],
  );
}
