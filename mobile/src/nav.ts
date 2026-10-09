import { useRouter, useSegments } from "expo-router";
import { useCallback, useEffect } from "react";

type Tab = "(home)" | "(search)";

export type Target = { artist: string } | { tag: string } | { playlist: string } | { album: { handle: string; slug: string } };

const isTab = (segment: string): segment is Tab => segment === "(home)" || segment === "(search)";

// the tab last seen in the route; the root navigator's own state does not follow a tab switched natively
let lastTab: Tab = "(home)";

/** The tab in the current route, if the route is inside one. Called by the tabs layout so the last one is remembered under a sheet. */
export function useShownTab(): Tab | undefined {
  const segments: string[] = useSegments();
  const shown = segments.find(isTab);
  useEffect(() => {
    if (shown) lastTab = shown;
  }, [shown]);
  return shown;
}

/** Detail screens push inside whichever tab is showing, so back returns where you were; from a sheet, that is the tab under it. */
export function useOpen() {
  const router = useRouter();
  const shown = useShownTab();
  return useCallback(
    (target: Target) => {
      const tab = shown ?? lastTab;
      if ("artist" in target) router.push({ pathname: `/(tabs)/${tab}/artist/[handle]`, params: { handle: target.artist } });
      else if ("tag" in target) router.push({ pathname: `/(tabs)/${tab}/tag/[name]`, params: { name: target.tag } });
      else if ("album" in target) router.push({ pathname: `/(tabs)/${tab}/album/[handle]/[slug]`, params: target.album });
      else router.push({ pathname: `/(tabs)/${tab}/playlist/[id]`, params: { id: target.playlist } });
    },
    [router, shown],
  );
}
