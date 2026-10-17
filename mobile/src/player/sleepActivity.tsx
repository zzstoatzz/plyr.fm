import { Button, HStack, Image, ProgressView, Spacer, Text, VStack } from "@expo/ui/swift-ui";
import { accessibilityLabel, buttonStyle, font, foregroundStyle, frame, labelsHidden, monospacedDigit, multilineTextAlignment, padding, tint } from "@expo/ui/swift-ui/modifiers";
import { createLiveActivity } from "expo-widgets";

/** Times are epoch milliseconds: props cross to the widget extension as JSON. */
export type SleepActivityProps = { startedAt: number; endsAt: number; label: string };

// the buttons' targets, as the widget function below spells them
export const SLEEP_EXTEND = "sleep:extend";
export const SLEEP_CANCEL = "sleep:cancel";

// runs inside the widget extension as source text: nothing outside the function exists there, not even this file's
// constants, and a reference to one leaves the island blank. Everything it draws comes in as props.
const SleepTimer = (props: SleepActivityProps) => {
  "widget";
  const accent = "#6A9FFF";
  const quiet = foregroundStyle({ type: "hierarchical", style: "secondary" });
  const span = { lower: new Date(props.startedAt), upper: new Date(props.endsAt) };
  const left = { lower: new Date(), upper: new Date(props.endsAt) };

  const moon = (size: number) => <Image systemName="moon.fill" size={size} color={accent} />;
  const countdown = (size: number, width: number) => (
    <Text
      timerInterval={left}
      countsDown
      modifiers={[font({ size, weight: "semibold" }), monospacedDigit(), multilineTextAlignment("trailing"), frame({ maxWidth: width }), accessibilityLabel("time until playback pauses")]}
    />
  );
  const controls = (
    <VStack spacing={10}>
      <ProgressView timerInterval={span} countsDown={false} modifiers={[tint(accent), labelsHidden()]} />
      <HStack spacing={10}>
        <Button label="+10 min" target="sleep:extend" modifiers={[buttonStyle("bordered"), tint(accent)]} />
        <Spacer />
        <Button label="cancel" target="sleep:cancel" modifiers={[buttonStyle("bordered"), tint("#B0B0B0")]} />
      </HStack>
    </VStack>
  );
  const title = (
    <HStack spacing={6}>
      {moon(15)}
      <Text modifiers={[font({ size: 14, weight: "semibold" })]}>{props.label}</Text>
    </HStack>
  );

  return {
    banner: (
      <VStack spacing={10} modifiers={[padding({ horizontal: 16, vertical: 14 })]}>
        <HStack>
          {title}
          <Spacer />
          {countdown(20, 90)}
        </HStack>
        {controls}
      </VStack>
    ),
    compactLeading: moon(15),
    compactTrailing: countdown(13, 44),
    minimal: moon(14),
    expandedLeading: <HStack modifiers={[padding({ leading: 6 })]}>{title}</HStack>,
    expandedTrailing: <HStack modifiers={[padding({ trailing: 6 }), quiet]}>{countdown(16, 70)}</HStack>,
    expandedBottom: <VStack modifiers={[padding({ horizontal: 6, top: 4 })]}>{controls}</VStack>,
  };
};

export const sleepActivity = createLiveActivity<SleepActivityProps>("SleepTimer", SleepTimer);
