import type { ArtistAlbum } from "plyr-shared/contract";
import { count } from "plyr-shared/format";
import { IMAGE_WIDTHS } from "plyr-shared/images";
import { FlatList, Pressable, StyleSheet, Text } from "react-native";
import { color, inset, radius } from "@/theme";
import { type } from "@/type";
import { Artwork } from "./Artwork";

const CARD = 148;

/** An artist's albums, side by side; the cards are the home screen's top-track cards. */
export function AlbumShelf({ albums, onOpen }: { albums: readonly ArtistAlbum[]; onOpen: (album: ArtistAlbum) => void }) {
  return (
    <FlatList
      horizontal
      data={albums}
      keyExtractor={(a) => a.id}
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.cards}
      renderItem={({ item }) => (
        <Pressable
          onPress={() => onOpen(item)}
          accessibilityRole="link"
          accessibilityLabel={`album: ${item.title}, ${count(item.track_count, "track")}`}
          style={({ pressed }) => [styles.card, pressed && { opacity: 0.7 }]}
        >
          <Artwork url={item.image_url} size={CARD} width={IMAGE_WIDTHS.tile} radius={radius.card} />
          <Text style={[type.secondary, type.strong, styles.title]} numberOfLines={1}>
            {item.title}
          </Text>
          <Text style={[type.meta, { color: color.muted }]} numberOfLines={1}>
            {count(item.track_count, "track")} · {count(item.total_plays, "play")}
          </Text>
        </Pressable>
      )}
    />
  );
}

const styles = StyleSheet.create({
  cards: { paddingHorizontal: inset, gap: 12 },
  card: { width: CARD, gap: 4 },
  title: { color: color.ink, marginTop: 4 },
});
