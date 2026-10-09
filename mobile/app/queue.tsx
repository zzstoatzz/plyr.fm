import { Button, Host, HStack, Image, List, RNHostView, Section, Spacer, Text, VStack } from "@expo/ui/swift-ui";
import {
  accessibilityAddTraits,
  accessibilityHint,
  accessibilityLabel,
  contentShape,
  deleteDisabled,
  font,
  foregroundStyle,
  lineLimit,
  listRowBackground,
  listStyle,
  moveDisabled,
  onTapGesture,
  scrollContentBackground,
  shapes,
  tint,
} from "@expo/ui/swift-ui/modifiers";
import { Stack, useRouter } from "expo-router";
import type { Track } from "plyr-shared/contract";
import { credits } from "plyr-shared/format";
import { IMAGE_WIDTHS, trackThumbnailUrl } from "plyr-shared/images";
import { tail, upNext, type Entry } from "plyr-shared/queue";
import { StyleSheet, Text as PlainText, View } from "react-native";
import { Artwork } from "@/components/Artwork";
import { haptic } from "@/haptics";
import { usePlayer } from "@/player/PlayerProvider";
import { color, radius } from "@/theme";
import { font as face, type } from "@/type";

const ART = 44;

export default function Queue() {
  const player = usePlayer();
  const router = useRouter();
  const { queue, track } = player;
  const picks = upNext(queue);
  const rest = tail(queue);

  // a section's rows are numbered from zero by the list; the queue numbers them from the section's first entry
  const within = (entries: readonly Entry[]) => ({
    onMove: (sources: number[], destination: number) => {
      const from = sources[0];
      if (from === undefined) return;
      const to = destination > from ? destination - 1 : destination;
      if (!entries[from] || !entries[to] || from === to) return;
      player.move(entries[from].index, entries[to].index);
      haptic.selection();
    },
    onDelete: (indices: number[]) => {
      const entry = entries[indices[0] ?? -1];
      if (entry) player.remove(entry.index);
    },
  });

  return (
    <>
      <Stack.Screen
        options={{
          title: "queue",
          headerRight: () => (
            <PlainText onPress={() => router.dismiss()} accessibilityRole="button" style={[type.body, type.strong, { color: color.accent }]}>
              done
            </PlainText>
          ),
        }}
      />
      {track ? (
        <Host style={styles.fill} seedColor={color.accent}>
          <List modifiers={[listStyle("plain"), scrollContentBackground("hidden"), tint(color.accent)]}>
            <Section header={<Heading title="now playing" />}>
              <Row track={track} current modifiers={[moveDisabled(), deleteDisabled()]} />
            </Section>
            <Section
              header={
                <Heading title="up next">
                  {picks.length > 1 ? <Button label="shuffle" systemImage="shuffle" onPress={player.shuffleUpNext} modifiers={[font({ family: face.regular, size: 15 })]} /> : null}
                  {picks.length > 0 ? <Button label="clear" onPress={player.clearUpNext} modifiers={[font({ family: face.regular, size: 15 })]} /> : null}
                </Heading>
              }
            >
              {picks.length === 0 ? <Note>{rest.length ? "nothing queued. hold a track anywhere to play it next." : "nothing else in the queue"}</Note> : null}
              <List.ForEach {...within(picks)}>
                {picks.map(({ track: t, index }) => (
                  <Row key={`${t.id}:${index}`} track={t} onPress={() => player.jumpTo(index)} />
                ))}
              </List.ForEach>
            </Section>
            {rest.length > 0 ? (
              <Section header={<Heading title={queue.tailLabel ? `next from: ${queue.tailLabel}` : "next"} />}>
                <List.ForEach {...within(rest)}>
                  {rest.map(({ track: t, index }) => (
                    <Row key={`${t.id}:${index}`} track={t} onPress={() => player.jumpTo(index)} />
                  ))}
                </List.ForEach>
              </Section>
            ) : null}
          </List>
        </Host>
      ) : (
        <View style={styles.empty}>
          <PlainText style={[type.body, { color: color.muted }]}>queue is empty</PlainText>
        </View>
      )}
    </>
  );
}

function Heading({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <HStack spacing={16}>
      <Text modifiers={[font({ family: face.bold, size: 15 }), foregroundStyle(color.muted), accessibilityAddTraits(["isHeader"])]}>{title}</Text>
      <Spacer />
      {children}
    </HStack>
  );
}

function Note({ children }: { children: string }) {
  return <Text modifiers={[font({ family: face.regular, size: 15 }), foregroundStyle(color.muted), listRowBackground(color.canvas), moveDisabled(), deleteDisabled()]}>{children}</Text>;
}

type RowProps = { track: Track; current?: boolean; onPress?: () => void; modifiers?: React.ComponentProps<typeof HStack>["modifiers"] };

function Row({ track, current = false, onPress, modifiers = [] }: RowProps) {
  const by = credits(track);
  // a wrapper around the row (a context menu, swipe actions) makes the list report every row as its first
  return (
    <HStack
      spacing={12}
      modifiers={[
        contentShape(shapes.rectangle()),
        ...(onPress ? [onTapGesture(onPress), accessibilityAddTraits(["isButton"]), accessibilityHint("plays this track")] : []),
        accessibilityLabel(`${track.title}, by ${by}${current ? ", now playing" : ""}`),
        listRowBackground(color.canvas),
        ...modifiers,
      ]}
    >
      <RNHostView matchContents>
        <Artwork url={trackThumbnailUrl(track)} size={ART} width={IMAGE_WIDTHS.thumb} radius={radius.art} />
      </RNHostView>
      <VStack alignment="leading" spacing={2}>
        <Text modifiers={[font({ family: face.bold, size: 17 }), foregroundStyle(current ? color.accent : color.ink), lineLimit(1)]}>{track.title}</Text>
        <Text modifiers={[font({ family: face.regular, size: 14 }), foregroundStyle(color.muted), lineLimit(1)]}>{by}</Text>
      </VStack>
      <Spacer />
      {current ? <Image systemName="waveform" size={18} color={color.accent} /> : null}
    </HStack>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  empty: { flex: 1, alignItems: "center", justifyContent: "center" },
});
