import { StyleSheet } from "react-native";
import { color } from "@/theme";
import { NativeScrubber } from "../../modules/scrubber";

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

/** The system slider in a strip tall enough to grab without aiming; a touch anywhere on it brings the thumb over. */
export function Scrubber({ value, max, label, valueText, onChange, onCommit }: Props) {
  return (
    <NativeScrubber
      style={styles.strip}
      value={value}
      max={max}
      step={STEP_SECONDS}
      tint={color.accent}
      label={label}
      valueText={valueText}
      onScrub={(event) => onChange(event.nativeEvent.value)}
      onCommit={(event) => onCommit(event.nativeEvent.value)}
    />
  );
}

const styles = StyleSheet.create({
  strip: { height: 56 },
});
