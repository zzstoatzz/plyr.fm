import { SymbolView } from "expo-symbols";
import { IMAGE_WIDTHS } from "plyr-shared/images";
import { Pressable, StyleSheet, Text, View, type PressableProps } from "react-native";
import { color, inset, radius, thumb } from "@/theme";
import { type } from "@/type";
import { Artwork } from "./Artwork";
import { Credits } from "./Credits";
import { Levels } from "./Levels";
import { useAccent } from "@/settings";

type Props = {
  title: string;
  artist: string;
  artwork: string | null;
  active?: boolean;
  /** Why it cannot play here, e.g. "supporters only"; the row stays readable but quiet. */
  locked?: string | null;
  onPlay: () => void;
  /** Everyone credited, each their own target on the line under the title; without it the line is plain text. */
  people?: readonly { name: string; handle: string }[];
  onArtist?: (handle: string) => void;
};

/** Extra props come from the link that carries the row's menu; its press is dropped, so a tap only plays. */
export function TrackRow({ title, artist, artwork, active = false, locked = null, onPlay, people, onArtist, ...link }: Props & Omit<PressableProps, keyof Props | "children" | "style">) {
  const { accent } = useAccent();
  const byline = locked ? `${artist} · ${locked}` : artist;
  const linked = onArtist ? people : undefined;
  return (
    <Pressable
      {...link}
      onPress={onPlay}
      disabled={locked !== null}
      accessibilityRole="button"
      accessibilityLabel={`${title}, by ${artist}`}
      accessibilityHint={locked ?? (active ? "now playing" : "plays this track")}
      accessibilityState={{ disabled: locked !== null, selected: active }}
      accessibilityActions={linked?.map((person) => ({ name: person.handle, label: `open ${person.name}` }))}
      onAccessibilityAction={(event) => onArtist?.(event.nativeEvent.actionName)}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: color.fill }]}
    >
      <View style={locked ? styles.quiet : null}>
        <Artwork url={artwork} size={thumb} width={IMAGE_WIDTHS.thumb} radius={radius.art} />
      </View>
      <View style={[styles.text, locked ? styles.quiet : null]}>
        <Text style={[type.row, { color: active ? accent : color.ink }]} numberOfLines={1}>
          {title}
        </Text>
        {linked && onArtist ? (
          <Credits people={linked} onOpen={onArtist} style={[type.meta, { color: color.muted }]} suffix={locked} />
        ) : (
          <Text style={[type.meta, { color: color.muted }]} numberOfLines={1}>
            {byline}
          </Text>
        )}
      </View>
      {active ? <Levels /> : null}
      {locked ? <SymbolView name="lock.fill" size={14} tintColor={color.muted} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: inset, paddingVertical: 8, minHeight: 64 },
  text: { flex: 1, gap: 2 },
  quiet: { opacity: 0.55 },
});
