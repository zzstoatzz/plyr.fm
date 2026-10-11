import { DEFAULT_TOP_PERIOD, periodsAfter, TOP_PERIOD_LABELS, type TopPeriod } from "plyr-shared/top";
import { useMemo, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import { topTracks, useTopTracks } from "@/data";
import { useAccent } from "@/settings";
import { color, inset } from "@/theme";
import { type } from "@/type";
import { TrackItem } from "./TrackItem";

const ROWS = 4;
/** How much of the next column's artwork shows, so the shelf reads as one you can swipe. */
const PEEK = 36;

/** The chart as pages of track rows: the same row, tap and hold menu as every other track. */
export function TopTracks() {
  const { accent } = useAccent();
  const { width } = useWindowDimensions();
  const [period, setPeriod] = useState<TopPeriod>(DEFAULT_TOP_PERIOD);
  const [cycling, setCycling] = useState(false);
  const client = useQueryClient();
  const { data, isPending } = useTopTracks(period);
  const tracks = useMemo(() => data ?? [], [data]);
  const columns = useMemo(() => Array.from({ length: Math.ceil(tracks.length / ROWS) }, (_, i) => i * ROWS), [tracks.length]);
  const page = columns.length > 1 ? width - inset - PEEK : width;

  // like the web toggle: step to the next period that has any tracks
  const cycle = async () => {
    setCycling(true);
    for (const candidate of periodsAfter(period)) {
      const found = await client.fetchQuery(topTracks(candidate)).catch(() => []);
      if (found.length > 0 || candidate === period) {
        setPeriod(candidate);
        break;
      }
    }
    setCycling(false);
  };

  if (!isPending && !tracks.length) return null;
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
          <Text style={[type.secondary, { color: accent }]}>{TOP_PERIOD_LABELS[period]}</Text>
        </Pressable>
      </View>
      <FlatList
        horizontal
        data={columns}
        keyExtractor={(start) => `${period}-${start}`}
        showsHorizontalScrollIndicator={false}
        snapToInterval={page}
        decelerationRate="fast"
        disableIntervalMomentum
        contentContainerStyle={{ paddingRight: width - page }}
        renderItem={({ item: start }) => (
          <View style={{ width: page }}>
            {tracks.slice(start, start + ROWS).map((track, i) => (
              <TrackItem key={track.id} tracks={tracks} index={start + i} label="top tracks" />
            ))}
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  section: { paddingTop: 8, paddingBottom: 16, gap: 4 },
  heading: { flexDirection: "row", alignItems: "baseline", gap: 10, paddingHorizontal: inset },
});
