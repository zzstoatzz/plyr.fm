import { requireNativeView } from "expo";
import type { ColorValue, ViewProps } from "react-native";

type Moved = { nativeEvent: { value: number } };

export type NativeScrubberProps = ViewProps & {
  value: number;
  max: number;
  /** Seconds one VoiceOver swipe moves. */
  step: number;
  tint?: ColorValue;
  label: string;
  /** What VoiceOver reads as the value, e.g. "1:02 of 3:40". */
  valueText: string;
  onScrub: (event: Moved) => void;
  onCommit: (event: Moved) => void;
};

/** The system slider, glass thumb and all, grabbed from anywhere along its strip. */
export const NativeScrubber = requireNativeView<NativeScrubberProps>("Scrubber");
