import { usePathname } from "expo-router";
import { NativeTabs } from "expo-router/unstable-native-tabs";
import { useEffect } from "react";
import { MiniPlayer } from "@/components/MiniPlayer";
import { usePlayer } from "@/player/PlayerProvider";
import { showTabBar, useTabBarHidden } from "@/tabBar";
import { color } from "@/theme";
import { font } from "@/type";

export const unstable_settings = { initialRouteName: "(home)" };

export default function TabsLayout() {
  const { track } = usePlayer();
  const hidden = useTabBarHidden();
  const pathname = usePathname();
  useEffect(showTabBar, [pathname]);
  return (
    <NativeTabs tintColor={color.accent} hidden={hidden} labelStyle={{ fontFamily: font.bold }}>
      <NativeTabs.Trigger name="(home)">
        <NativeTabs.Trigger.Icon sf={{ default: "house", selected: "house.fill" }} />
        <NativeTabs.Trigger.Label>home</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="(search)">
        <NativeTabs.Trigger.Icon sf="magnifyingglass" />
        <NativeTabs.Trigger.Label>search</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      {track ? (
        <NativeTabs.BottomAccessory>
          <MiniPlayer />
        </NativeTabs.BottomAccessory>
      ) : null}
    </NativeTabs>
  );
}
