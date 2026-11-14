import { useRef, useState } from 'react';
import { ScrollView, StyleSheet, View, type ScrollViewInstance } from 'react-native';
import { useAppearance } from './appearance';
import { X } from './icons';
import { PlayerControl } from './PlayerControl';
import { QueueContent } from './QueueContent';
import { setQueuePanel } from './queue-panel';
import { Text } from './Text';

export const QUEUE_PANEL_WIDTH = 360;
/** Below this window width the panel floats over the page instead of narrowing it. */
export const QUEUE_DOCK_WIDTH = 1280;

/** The queue beside whatever you are browsing, as prod has it: open it from the player bar, and it stays open across pages. */
export function QueuePanel({ floating }: { floating: boolean }) {
  const theme = useAppearance();
  const [dragging, setDragging] = useState(false);
  const scrollRef = useRef<ScrollViewInstance>(null);
  const scrollMetrics = useRef({ offset: 0, height: 0, contentHeight: 0 });
  return <View testID="queue-panel" role="complementary" aria-label="Queue" style={[styles.panel, { backgroundColor: theme.background, borderColor: theme.hairline },
    floating && [styles.floating, { borderColor: theme.dark ? theme.line : theme.border, boxShadow: theme.dark ? '-16px 0px 48px #000000cc' : '-12px 0px 32px #00000024' }]]}>
    <View style={styles.head}>
      <Text accessibilityRole="header" aria-level={2} style={{ flex: 1, color: theme.text, fontFamily: theme.fontFamily, fontSize: 20 * theme.scale, fontWeight: '700' }}>queue</Text>
      <PlayerControl icon={X} label="Close queue" onPress={() => setQueuePanel(false)} />
    </View>
    <ScrollView ref={scrollRef} scrollEnabled={!dragging} scrollEventThrottle={16} contentContainerStyle={styles.content}
      onScroll={event => { scrollMetrics.current.offset = event.nativeEvent.contentOffset.y; }}
      onLayout={event => { scrollMetrics.current.height = event.nativeEvent.layout.height; }}
      onContentSizeChange={(_, height) => { scrollMetrics.current.contentHeight = height; }}>
      <QueueContent scrollRef={scrollRef} scrollMetrics={scrollMetrics} onDragging={setDragging} />
    </ScrollView>
  </View>;
}

const styles = StyleSheet.create({
  panel: { width: QUEUE_PANEL_WIDTH, borderLeftWidth: StyleSheet.hairlineWidth },
  floating: { position: 'absolute', top: 12, right: 12, bottom: 12, borderRadius: 14, borderWidth: 1, overflow: 'hidden', zIndex: 50 },
  head: { flexDirection: 'row', alignItems: 'center', paddingLeft: 20, paddingRight: 8, minHeight: 56 },
  content: { paddingHorizontal: 12, paddingBottom: 24, gap: 16 },
});
