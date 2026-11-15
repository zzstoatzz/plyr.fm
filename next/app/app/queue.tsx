import { useRef, useState } from 'react';
import type { ScrollViewInstance } from 'react-native';
import { Page } from '../src/controls';
import { QueueContent } from '../src/QueueContent';

export default function Queue() {
  const [dragging, setDragging] = useState(false);
  const scrollRef = useRef<ScrollViewInstance>(null);
  const scrollMetrics = useRef({ offset: 0, height: 0, contentHeight: 0 });
  return <Page title="queue" scrollRef={scrollRef} scrollEnabled={!dragging}
    onScroll={event => { scrollMetrics.current.offset = event.nativeEvent.contentOffset.y; }}
    onLayout={event => { scrollMetrics.current.height = event.nativeEvent.layout.height; }}
    onContentSizeChange={(_, height) => { scrollMetrics.current.contentHeight = height; }}>
    <QueueContent scrollRef={scrollRef} scrollMetrics={scrollMetrics} onDragging={setDragging} />
  </Page>;
}
