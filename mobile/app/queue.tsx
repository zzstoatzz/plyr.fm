import { Button, Host, HStack, Image, List, RNHostView, Section, Spacer, Text, VStack } from "@expo/ui/swift-ui";
import {
  accessibilityAddTraits,
  accessibilityElement,
  accessibilityHint,
  accessibilityLabel,
  contentShape,
  deleteDisabled,
  disabled,
  font,
  foregroundStyle,
  lineLimit,
  listRowBackground,
  listRowInsets,
  listRowSeparator,
  listSectionSpacing,
  listStyle,
  moveDisabled,
  onTapGesture,
  padding,
  scrollContentBackground,
  shapes,
  tint,
} from "@expo/ui/swift-ui/modifiers";
import { Stack, useRouter } from "expo-router";
import type { Track } from "plyr-shared/contract";
import { count, credits } from "plyr-shared/format";
import { IMAGE_WIDTHS, trackThumbnailUrl } from "plyr-shared/images";
import { tail, upNext } from "plyr-shared/queue";
import { Pressable, StyleSheet, Text as PlainText, View } from "react-native";
import { Artwork } from "@/components/Artwork";
import { Levels } from "@/components/Levels";
import { haptic } from "@/haptics";
import { canPlay, usePlayer } from "@/player/PlayerProvider";
import { color, inset, radius, thumb } from "@/theme";
import { font as face, type } from "@/type";
import { useAccent } from "@/settings";

// a row as the rest of the app draws one: artwork at the inset, no rule between rows
const plain = [listRowBackground(color.canvas), listRowSeparator("hidden"), listRowInsets({ top: 8, bottom: 8, leading: inset, trailing: inset })];

// the app's type roles for SwiftUI text: Comic Neue at the role's size, scaling with Dynamic Type
const role = {
  row: font({ family: face.bold, size: 17, textStyle: "body" }),
  meta: font({ family: face.regular, size: 14, textStyle: "footnote" }),
  heading: font({ family: face.bold, size: 21, textStyle: "title3" }),
  note: font({ family: face.regular, size: 15, textStyle: "subheadline" }),
};

export default function Queue() {
  const { accent } = useAccent();
  const player = usePlayer();
  const router = useRouter();
  const { queue, track } = player;
  const picks = upNext(queue);
  const rest = tail(queue);
  // one list holds the picks, a divider, then the tail, so a drag can cross from one to the other
  const divider = rest.length > 0 ? picks.length : -1;
  const entryAt = (row: number) => (row < picks.length ? picks[row] : rest[row - picks.length - 1]);

  return (
    <>
      <Stack.Screen
        options={{
          title: "queue",
          headerRight: () => (
            <Pressable onPress={() => router.dismiss()} accessibilityRole="button" hitSlop={12}>
              <PlainText style={[type.body, type.strong, { color: accent }]}>done</PlainText>
            </Pressable>
          ),
        }}
      />
      {track ? (
        <Host style={styles.fill} seedColor={accent}>
          <List modifiers={[listStyle("plain"), listSectionSpacing(12), scrollContentBackground("hidden"), tint(accent)]}>
            <Section header={<Heading title="now playing" />}>
              <Row track={track} current modifiers={[moveDisabled(), deleteDisabled()]} />
            </Section>
            <Section
              header={
                <Heading title="up next" detail={picks.length ? String(picks.length) : undefined}>
                  <Button
                    label="shuffle"
                    systemImage="shuffle"
                    onPress={player.shuffleUpNext}
                    modifiers={[role.note, disabled(picks.length < 2), accessibilityLabel(picks.length < 2 ? "nothing to shuffle" : "shuffle up next")]}
                  />
                  <Button
                    label="clear"
                    role="destructive"
                    onPress={player.clearUpNext}
                    modifiers={[role.note, disabled(picks.length === 0), accessibilityLabel("clear your queued tracks")]}
                  />
                </Heading>
              }
            >
              {picks.length === 0 ? <Note>{rest.length ? "drag a track here to play it next" : "nothing else in the queue"}</Note> : null}
              <List.ForEach
                onMove={(sources, destination) => {
                  const from = sources[0];
                  if (from === undefined) return;
                  player.dragTo(from, destination > from ? destination - 1 : destination);
                  haptic.selection();
                }}
                onDelete={(rows) => {
                  const entry = entryAt(rows[0] ?? -1);
                  if (entry) player.remove(entry.index);
                }}
              >
                {picks.map(({ track: t, index }) => (
                  <Row key={`${t.id}:${index}`} track={t} onPress={() => player.jumpTo(index)} />
                ))}
                {divider === -1 ? null : (
                  <VStack
                    key="divider"
                    alignment="leading"
                    spacing={2}
                    modifiers={[
                      accessibilityElement("combine"),
                      accessibilityAddTraits(["isHeader"]),
                      ...plain,
                      listRowInsets({ top: 24, bottom: 6, leading: inset, trailing: inset }),
                      moveDisabled(),
                      deleteDisabled(),
                    ]}
                  >
                    <Text modifiers={[role.heading, foregroundStyle(color.ink), lineLimit(1)]}>{queue.tailLabel ? `next from: ${queue.tailLabel}` : "next"}</Text>
                    <Text modifiers={[role.meta, foregroundStyle(color.muted)]}>{count(rest.length, "track")}</Text>
                  </VStack>
                )}
                {rest.map(({ track: t, index }) => (
                  <Row key={`${t.id}:${index}`} track={t} onPress={() => player.jumpTo(index)} />
                ))}
              </List.ForEach>
            </Section>
          </List>
        </Host>
      ) : (
        <View style={styles.empty}>
          <PlainText style={[type.body, { color: color.ink }]}>queue is empty</PlainText>
          <PlainText style={[type.secondary, { color: color.muted }]}>add tracks to get started</PlainText>
        </View>
      )}
    </>
  );
}

function Heading({ title, detail, children }: { title: string; detail?: string; children?: React.ReactNode }) {
  return (
    <HStack spacing={16} alignment="firstTextBaseline" modifiers={[padding({ top: 8, bottom: 4, leading: inset - 16, trailing: inset - 16 })]}>
      <Text modifiers={[role.heading, foregroundStyle(color.ink), accessibilityAddTraits(["isHeader"])]}>{title}</Text>
      {detail ? <Text modifiers={[role.note, foregroundStyle(color.muted)]}>{detail}</Text> : null}
      <Spacer />
      {children}
    </HStack>
  );
}

function Note({ children }: { children: string }) {
  return <Text modifiers={[role.note, foregroundStyle(color.muted), ...plain, moveDisabled(), deleteDisabled()]}>{children}</Text>;
}

type RowProps = { track: Track; current?: boolean; onPress?: () => void; modifiers?: React.ComponentProps<typeof HStack>["modifiers"] };

function Row({ track, current = false, onPress, modifiers = [] }: RowProps) {
  const { accent } = useAccent();
  const by = credits(track);
  const playable = canPlay(track);
  const state = current ? ", now playing" : playable ? "" : ", can’t play here";
  // a wrapper around the row (a context menu, swipe actions) makes the list report every row as its first
  return (
    <HStack
      spacing={12}
      modifiers={[
        contentShape(shapes.rectangle()),
        ...(onPress && playable ? [onTapGesture(onPress)] : []),
        accessibilityElement("ignore"),
        accessibilityLabel(`${track.title}, by ${by}${state}`),
        ...(onPress && playable ? [accessibilityAddTraits(["isButton"]), accessibilityHint("plays this track")] : []),
        ...plain,
        ...modifiers,
      ]}
    >
      <RNHostView matchContents>
        <Artwork url={trackThumbnailUrl(track)} size={thumb} width={IMAGE_WIDTHS.thumb} radius={radius.art} />
      </RNHostView>
      <VStack alignment="leading" spacing={2}>
        <Text modifiers={[role.row, foregroundStyle(current ? accent : playable ? color.ink : color.muted), lineLimit(1)]}>{track.title}</Text>
        <Text modifiers={[role.meta, foregroundStyle(color.muted), lineLimit(1)]}>{by}</Text>
      </VStack>
      <Spacer />
      {current ? (
        <RNHostView matchContents>
          <Levels />
        </RNHostView>
      ) : playable ? null : <Image systemName="lock.fill" size={14} color={color.muted} />}
    </HStack>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: 4 },
});
