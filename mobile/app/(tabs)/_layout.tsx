import { NativeTabs } from "expo-router/unstable-native-tabs";
import { MiniPlayer } from "@/components/MiniPlayer";
import { usePlayer } from "@/player/PlayerProvider";
import { color } from "@/theme";

export const unstable_settings = { initialRouteName: "(home)" };

export default function TabsLayout() {
  const { track } = usePlayer();
  return (
    <NativeTabs tintColor={color.accent} minimizeBehavior="onScrollDown">
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
