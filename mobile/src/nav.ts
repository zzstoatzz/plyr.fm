import { useRootNavigationState, useRouter } from "expo-router";
import { useCallback } from "react";

type Tab = "(home)" | "(search)";

export type Target = { artist: string } | { tag: string } | { playlist: string } | { album: { handle: string; slug: string } };

/** Detail screens push inside whichever tab is showing, so back returns where you were. */
export function useOpen() {
  const router = useRouter();
  const tabs = useRootNavigationState()?.routes.find((route) => route.name === "(tabs)")?.state;
  const tab: Tab = tabs?.routes[tabs.index ?? 0]?.name === "(search)" ? "(search)" : "(home)";
  return useCallback(
    (target: Target) => {
      if ("artist" in target) router.push({ pathname: `/(tabs)/${tab}/artist/[handle]`, params: { handle: target.artist } });
      else if ("tag" in target) router.push({ pathname: `/(tabs)/${tab}/tag/[name]`, params: { name: target.tag } });
      else if ("album" in target) router.push({ pathname: `/(tabs)/${tab}/album/[handle]/[slug]`, params: target.album });
      else router.push({ pathname: `/(tabs)/${tab}/playlist/[id]`, params: { id: target.playlist } });
    },
    [router, tab],
  );
}
