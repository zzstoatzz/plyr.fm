import { Host, HStack, Image, Text } from "@expo/ui/swift-ui";
import { font, foregroundStyle, glassEffect, lineLimit, padding } from "@expo/ui/swift-ui/modifiers";
import { useRouter } from "expo-router";
import { Pressable, StyleSheet, View } from "react-native";
import Animated, { FadeInDown, FadeOut } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { usePlayer } from "@/player/PlayerProvider";
import { useTabBarHidden } from "@/tabBar";
import { color } from "@/theme";
import { dismissQueueBanner, useQueueBanner } from "@/queueBanner";
import { font as face } from "@/type";

// what sits under the banner, from the home indicator up: the tab bar, then the mini player
const TAB_BAR = 62;
const MINI_PLAYER = 62;
const GAP = 8;

const label = font({ family: face.bold, size: 15, textStyle: "subheadline" });

/** "queued …": a glass pill just above the mini player, or above whatever is left when that is gone. Tapping it opens the queue. Rendered once, over the tabs. */
export function QueueBanner() {
  const banner = useQueueBanner();
  const router = useRouter();
  const { bottom } = useSafeAreaInsets();
  const barHidden = useTabBarHidden();
  const { track } = usePlayer();
  if (!banner) return null;
  const above = bottom + GAP + (barHidden ? 0 : TAB_BAR) + (track ? MINI_PLAYER : 0);
  return (
    <View style={[styles.row, { bottom: above }]} pointerEvents="box-none">
      <Animated.View key={banner.id} entering={FadeInDown.duration(220)} exiting={FadeOut.duration(250)}>
        <Host matchContents>
          <HStack spacing={8} modifiers={[padding({ horizontal: 16, vertical: 11 }), glassEffect({ glass: { variant: "regular" }, shape: "capsule" })]}>
            <Image systemName={banner.symbol} size={15} color={color.accent} />
            <Text modifiers={[label, foregroundStyle(color.ink), lineLimit(1)]}>{banner.message}</Text>
          </HStack>
        </Host>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={() => {
            dismissQueueBanner();
            router.push("/queue");
          }}
          accessibilityRole="button"
          accessibilityLabel={banner.message}
          accessibilityHint="opens the queue"
        />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { position: "absolute", left: 24, right: 24, alignItems: "center" },
});
