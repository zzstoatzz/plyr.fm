import { SymbolView, type SFSymbol } from "expo-symbols";
import { ActivityIndicator, Pressable, StyleSheet, type ColorValue } from "react-native";
import { haptic, type Feedback } from "@/haptics";
import { usePlayer } from "@/player/PlayerProvider";
import { color } from "@/theme";

type ButtonProps = {
  symbol: SFSymbol;
  label: string;
  size: number;
  disabled?: boolean;
  selected?: boolean;
  tint?: ColorValue;
  /** Felt as the press lands, for a control whose effect is heard or elsewhere on screen. */
  feedback?: Feedback;
  onPress: () => void;
};

export function TransportButton({ symbol, label, size, disabled = false, selected, tint = color.ink, feedback, onPress }: ButtonProps) {
  return (
    <Pressable
      onPress={() => {
        if (feedback) haptic[feedback]();
        onPress();
      }}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled, selected }}
      hitSlop={10}
      style={({ pressed }) => [styles.button, { minWidth: Math.max(44, size), minHeight: Math.max(44, size) }, (pressed || disabled) && { opacity: disabled ? 0.35 : 0.6 }]}
    >
      <SymbolView name={symbol} size={size} tintColor={tint} />
    </Pressable>
  );
}

/** Play/pause that shows the spinner while a track loads, so a tap never seems to do nothing. */
export function PlayPause({ size }: { size: number }) {
  const { status, toggle } = usePlayer();
  if (status === "loading") return <ActivityIndicator color={color.ink} style={{ minWidth: 44, minHeight: Math.max(44, size) }} accessibilityLabel="loading" />;
  const playing = status === "playing" || status === "buffering";
  return <TransportButton symbol={playing ? "pause.fill" : "play.fill"} label={playing ? "pause" : "play"} size={size} feedback="tap" onPress={toggle} />;
}

const styles = StyleSheet.create({
  button: { alignItems: "center", justifyContent: "center" },
});
