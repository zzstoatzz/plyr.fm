import { useRef, type ReactNode } from 'react';
import { ScrollView } from 'react-native';

export function TagScroller({ children, onNearEnd }: { children: ReactNode; onNearEnd: () => void }) {
  const viewport = useRef({ width: 0, content: 0, offset: 0 });
  function check() {
    const { width, content, offset } = viewport.current;
    if (width > 0 && content > 0 && content - width - offset < width) onNearEnd();
  }
  return <ScrollView horizontal testID="home-tags" showsHorizontalScrollIndicator={false}
    contentContainerStyle={{ gap: 6, alignItems: 'center' }}
    onLayout={event => { viewport.current.width = event.nativeEvent.layout.width; check(); }}
    onContentSizeChange={width => { viewport.current.content = width; check(); }}
    onScroll={event => { viewport.current.offset = event.nativeEvent.contentOffset.x; check(); }} scrollEventThrottle={32}>
    {children}
  </ScrollView>;
}
