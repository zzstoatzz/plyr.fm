import { IMAGE_WIDTHS, trackCoverUrl } from "plyr-shared/images";
import { DEFAULT_TOP_PERIOD, periodsAfter, TOP_PERIOD_LABELS, type TopPeriod } from "plyr-shared/top";
import { useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import { topTracks, useTopTracks } from "@/data";
import { useOpen } from "@/nav";
import { canPlay, usePlayer } from "@/player/PlayerProvider";
import { color, inset, radius } from "@/theme";
import { type } from "@/type";
import { Artwork } from "./Artwork";

const CARD = 148;

export function TopTracks() {
  const [period, setPeriod] = useState<TopPeriod>(DEFAULT_TOP_PERIOD);
  const [cycling, setCycling] = useState(false);
  const client = useQueryClient();
  const { data, isPending } = useTopTracks(period);
  const player = usePlayer();
  const open = useOpen();

  // like the web toggle: step to the next period that has any tracks
  const cycle = async () => {
    setCycling(true);
    for (const candidate of periodsAfter(period)) {
      const tracks = await client.fetchQuery(topTracks(candidate)).catch(() => []);
      if (tracks.length > 0 || candidate === period) {
        setPeriod(candidate);
        break;
      }
    }
    setCycling(false);
  };

  if (!isPending && !data?.length) return null;
  return (
    <View style={styles.section}>
      <View style={styles.heading}>
        <Text style={[type.section, { color: color.ink }]} accessibilityRole="header">
          top tracks
        </Text>
        <Pressable
          onPress={() => void cycle()}
          disabled={cycling}
          accessibilityRole="button"
          accessibilityLabel={`period: ${TOP_PERIOD_LABELS[period]}`}
          accessibilityHint="shows the next period"
          hitSlop={12}
        >
          <Text style={[type.secondary, { color: color.accent }]}>{TOP_PERIOD_LABELS[period]}</Text>
        </Pressable>
      </View>
      <FlatList
        horizontal
        data={data ?? []}
        keyExtractor={(t) => String(t.id)}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.cards}
        renderItem={({ item, index }) => {
          const active = player.track?.id === item.id;
          return (
            <Pressable
              onPress={() => player.playList(data ?? [], index)}
              disabled={!canPlay(item)}
              accessibilityRole="button"
              accessibilityLabel={`${item.title}, by ${item.artist}`}
              accessibilityState={{ selected: active, disabled: !canPlay(item) }}
              style={({ pressed }) => [styles.card, pressed && { opacity: 0.7 }]}
            >
              <Artwork url={trackCoverUrl(item)} size={CARD} width={IMAGE_WIDTHS.tile} radius={radius.card} />
              <Text style={[type.secondary, type.strong, styles.title, { color: active ? color.accent : color.ink }]} numberOfLines={1}>
                {item.title}
              </Text>
              <Pressable
                onPress={() => open({ artist: item.artist_handle })}
                hitSlop={{ top: 4, bottom: 10 }}
                accessibilityRole="link"
                accessibilityLabel={item.artist}
                accessibilityHint="opens the artist"
              >
                {({ pressed }) => (
                  <Text style={[type.meta, { color: pressed ? color.accent : color.muted }]} numberOfLines={1}>
                    {item.artist}
                  </Text>
                )}
              </Pressable>
            </Pressable>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  section: { paddingTop: 8, paddingBottom: 16, gap: 10 },
  heading: { flexDirection: "row", alignItems: "baseline", gap: 10, paddingHorizontal: inset },
  cards: { paddingHorizontal: inset, gap: 12 },
  card: { width: CARD, gap: 4 },
  title: { marginTop: 4 },
});
