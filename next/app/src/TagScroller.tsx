import { useAppearance } from './appearance';
import { useEffect, useRef, type ReactNode } from 'react';
import { ScrollView, type ScrollViewInstance } from 'react-native';

export function TagScroller({ children, hasMore, onNearEnd, lead }: { children: ReactNode; hasMore: boolean; onNearEnd: () => void; lead: number }) {
  const colors = useAppearance();
  const scroller = useRef<ScrollViewInstance>(null);
  const viewport = useRef({ width: 0, content: 0, offset: 0 });
  const previous = useRef(lead);
  useEffect(() => {
    const grew = lead > previous.current;
    previous.current = lead;
    if (!grew || viewport.current.offset <= 0) return;
    const frame = requestAnimationFrame(() => scroller.current?.scrollTo({ x: 0, animated: !colors.reduceMotion }));
    return () => cancelAnimationFrame(frame);
  }, [lead, colors.reduceMotion]);
  function check() {
    const { width, content, offset } = viewport.current;
    if (hasMore && width > 0 && content > 0 && content - width - offset < width * 3) onNearEnd();
  }
  return <ScrollView ref={scroller} horizontal testID="home-tags" showsHorizontalScrollIndicator={false}
    contentContainerStyle={{ gap: 6, alignItems: 'center' }}
    onLayout={event => { viewport.current.width = event.nativeEvent.layout.width; check(); }}
    onContentSizeChange={width => { viewport.current.content = width; check(); }}
    onScroll={event => { viewport.current.offset = event.nativeEvent.contentOffset.x; check(); }} scrollEventThrottle={32}>
    {children}
  </ScrollView>;
}
