import { useState } from "react";
import { StyleSheet, View, type GestureResponderEvent } from "react-native";
import { color } from "@/theme";

const TRACK = 4;
const THUMB = 12;
const THUMB_HELD = 18;
const STEP_SECONDS = 15;

type Props = {
  value: number;
  max: number;
  label: string;
  /** What VoiceOver reads as the value, e.g. "1:02 of 3:40". */
  valueText: string;
  onChange: (value: number) => void;
  onCommit: (value: number) => void;
};

/** A thin scrubber with a small thumb; the whole 44pt-tall strip takes the touch. */
export function Scrubber({ value, max, label, valueText, onChange, onCommit }: Props) {
  const [width, setWidth] = useState(0);
  const [held, setHeld] = useState(false);
  const fraction = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  const thumb = held ? THUMB_HELD : THUMB;
  const at = (event: GestureResponderEvent) => (width > 0 ? Math.max(0, Math.min(1, event.nativeEvent.locationX / width)) * max : 0);

  return (
    <View
      style={styles.strip}
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      onStartShouldSetResponder={() => max > 0}
      onMoveShouldSetResponder={() => max > 0}
      onResponderTerminationRequest={() => false}
      onResponderGrant={(event) => {
        setHeld(true);
        onChange(at(event));
      }}
      onResponderMove={(event) => onChange(at(event))}
      onResponderRelease={(event) => {
        setHeld(false);
        onCommit(at(event));
      }}
      onResponderTerminate={() => {
        setHeld(false);
        onCommit(value);
      }}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityValue={{ text: valueText }}
      accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
      onAccessibilityAction={(event) => {
        const step = event.nativeEvent.actionName === "increment" ? STEP_SECONDS : -STEP_SECONDS;
        onCommit(Math.max(0, Math.min(max, value + step)));
      }}
    >
      <View style={styles.track} pointerEvents="none">
        <View style={[styles.played, { width: `${fraction * 100}%` }]} />
      </View>
      <View pointerEvents="none" style={[styles.thumb, { width: thumb, height: thumb, borderRadius: thumb / 2, left: fraction * (width - thumb) }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  strip: { height: 44, justifyContent: "center" },
  track: { height: TRACK, borderRadius: TRACK / 2, backgroundColor: color.fill, overflow: "hidden" },
  played: { height: TRACK, backgroundColor: color.accent },
  thumb: { position: "absolute", backgroundColor: color.accent },
});
