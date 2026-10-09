import { Button, Host, Image, Menu, Section } from "@expo/ui/swift-ui";
import { accessibilityLabel, contentShape, frame, shapes } from "@expo/ui/swift-ui/modifiers";
import { useEffect, useState } from "react";
import { SLEEP_EXTENSION_MINUTES, SLEEP_MINUTES, sleepChoice, sleepRemaining } from "@/player/sleep";
import { useSleep } from "@/player/useSleepTimer";
import { color } from "@/theme";

const REFRESH_MS = 20_000;

/** The player's sleep timer: a moon that opens a system menu, filled and accent while a timer runs. */
export function SleepButton() {
  const { sleep, sleepAfter, sleepAtTrackEnd, extendSleep, cancelSleep, activityProblem } = useSleep();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!sleep) return;
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const timer = setInterval(tick, REFRESH_MS);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [sleep]);

  return (
    <Host matchContents seedColor={color.accent}>
      <Menu
        label={
          <Image
            systemName={sleep ? "moon.fill" : "moon"}
            size={20}
            color={sleep ? color.accent : color.muted}
            modifiers={[frame({ width: 44, height: 44 }), contentShape(shapes.rectangle()), accessibilityLabel(sleep ? "sleep timer, on" : "sleep timer")]}
          />
        }
      >
        <Section title={sleep ? `sleep timer · ${sleepRemaining(sleep, now)}` : "sleep timer"}>
          {sleep ? <Button label={`${SLEEP_EXTENSION_MINUTES} more minutes`} systemImage="plus" onPress={extendSleep} /> : null}
          {SLEEP_MINUTES.map((minutes) => (
            <Button key={minutes} label={sleepChoice(minutes)} onPress={() => sleepAfter(minutes)} />
          ))}
          <Button label="end of this track" onPress={sleepAtTrackEnd} />
        </Section>
        {sleep && activityProblem ? <Section title={`not in the island: ${activityProblem}`}>{null}</Section> : null}
        {sleep ? <Button label="turn off" role="destructive" systemImage="moon.zzz" onPress={cancelSleep} /> : null}
      </Menu>
    </Host>
  );
}
