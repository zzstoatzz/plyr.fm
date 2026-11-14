import { useAppearance } from './appearance';
import { CaretLeft as ChevronLeft, CaretRight as ChevronRight } from './icons';
import { useRef, useState, type ReactNode } from 'react';
import { ScrollView, StyleSheet, View, type ScrollViewInstance } from 'react-native';
import { PlayerControl } from './PlayerControl';

export function HomeShelf({ testID, heading, label, busy = false, children }: {
  testID: string; heading: ReactNode; label: string; busy?: boolean; children: ReactNode;
}) {
  const colors = useAppearance();
  const scroller = useRef<ScrollViewInstance>(null);
  const [view, setView] = useState({ width: 0, content: 0, offset: 0 });
  const overflow = view.content > view.width + 1;
  const page = (direction: 1 | -1) => scroller.current?.scrollTo({ x: Math.max(0, view.offset + direction * view.width * 0.8), animated: !colors.reduceMotion });
  return <View testID={testID} style={styles.section}>
    <View style={styles.header}>
      <View style={styles.heading}>{heading}</View>
      {overflow && view.width >= 600 && <View style={{ flexDirection: 'row' }}>
        <PlayerControl icon={ChevronLeft} label={`Previous ${label}`} disabled={view.offset <= 0} onPress={() => page(-1)} />
        <PlayerControl icon={ChevronRight} label={`Next ${label}`} disabled={view.offset + view.width >= view.content - 1} onPress={() => page(1)} />
      </View>}
    </View>
    <ScrollView ref={scroller} horizontal testID={`${testID}-items`} showsHorizontalScrollIndicator={false} scrollEnabled={!busy} contentContainerStyle={styles.items}
      accessibilityState={{ busy }} scrollEventThrottle={32}
      onLayout={event => { const { width } = event.nativeEvent.layout; setView(previous => ({ ...previous, width })); }}
      onContentSizeChange={content => setView(previous => ({ ...previous, content }))}
      onScroll={event => { const offset = event.nativeEvent.contentOffset.x; setView(previous => ({ ...previous, offset })); }}>
      {children}
    </ScrollView>
  </View>;
}

const styles = StyleSheet.create({
  section: { gap: 6 }, header: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44 },
  heading: { flex: 1, minWidth: 0, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10 },
  items: { gap: 8 },
});
