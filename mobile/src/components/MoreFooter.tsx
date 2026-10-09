import { ActivityIndicator, Pressable, StyleSheet, Text } from "react-native";
import { color } from "@/theme";
import { type } from "@/type";

/** The paging half of an infinite query. */
export type Paged = { hasNextPage: boolean; isFetchingNextPage: boolean; isFetchNextPageError: boolean; fetchNextPage: () => unknown };

/** How far from the end, in screens, the next page is asked for. */
export const END_THRESHOLD = 2;

/** For `onEndReached`. A page that failed waits for a tap: the footer changing size re-fires the list's end event, which would retry forever. */
export function loadMore(pages: Paged) {
  if (pages.hasNextPage && !pages.isFetchingNextPage && !pages.isFetchNextPageError) void pages.fetchNextPage();
}

/** The end of a paged list: a spinner while more exists, or a way to retry when the next page did not arrive. */
export function MoreFooter({ pages }: { pages: Paged }) {
  if (!pages.hasNextPage) return null;
  if (pages.isFetchNextPageError && !pages.isFetchingNextPage) {
    return (
      <Pressable onPress={() => void pages.fetchNextPage()} accessibilityRole="button" style={styles.more}>
        {({ pressed }) => (
          <Text style={[type.secondary, { color: color.accent, textAlign: "center", opacity: pressed ? 0.6 : 1 }]}>couldn’t load more. tap to try again.</Text>
        )}
      </Pressable>
    );
  }
  return <ActivityIndicator style={styles.more} color={color.muted} accessibilityLabel="loading more" />;
}

const styles = StyleSheet.create({
  more: { padding: 20, minHeight: 44, justifyContent: "center" },
});
