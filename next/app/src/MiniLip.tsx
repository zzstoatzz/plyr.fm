import { clock } from '@plyr/next-core/chapters';
import { useEffect, useMemo, useRef, useState } from 'react';
import { PanResponder, StyleSheet, View, type ViewInstance } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { useAppearance } from './appearance';
import { useAdjustable } from './behaviors/use-adjustable';
import { usePlayback } from './playback';

/** The mini player's progress as a soft accent wash filling it. A sideways drag along its bottom scrubs; taps and vertical swipes don't. */
export function MiniLip({ capsule, onScrub }: { capsule: boolean; onScrub: (seconds: number | undefined) => void }) {
  const player = usePlayback();
  const theme = useAppearance();
  const track = player.current!;
  const duration = player.status.duration || track.metadata.duration_seconds || 0;
  const enabled = player.canSeek && duration > 0 && !player.live;
  const [dragging, setDragging] = useState<number>();
  const [{ width, height }, setSize] = useState({ width: 0, height: 0 });
  const radius = capsule ? height / 2 : 0;
  const band = useRef<ViewInstance>(null);
  const left = useRef(0);
  const position = Math.max(0, Math.min(duration, dragging ?? player.seekPreview ?? player.status.currentTime));
  const latest = useRef({ duration, enabled, width, seek: player.seek, onScrub });
  latest.current = { duration, enabled, width, seek: player.seek, onScrub };
  const at = (pageX: number) => {
    const { duration, width } = latest.current;
    return width ? Math.max(0, Math.min(1, (pageX - left.current) / width)) * duration : 0;
  };
  const update = (seconds: number | undefined) => { setDragging(seconds); latest.current.onScrub(seconds); };
  const responder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_, gesture) => latest.current.enabled && Math.abs(gesture.dx) > 6 && Math.abs(gesture.dx) > Math.abs(gesture.dy),
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: (_, gesture) => {
      band.current?.measureInWindow(x => { left.current = x; });
      update(at(gesture.moveX));
    },
    onPanResponderMove: (_, gesture) => update(at(gesture.moveX)),
    onPanResponderRelease: (_, gesture) => { void latest.current.seek(at(gesture.moveX)); update(undefined); },
    onPanResponderTerminate: () => update(undefined),
  }), []);
  // Losing seek permission mid-drag (a jam host taking over) drops the drag; the parent remounts this per track.
  useEffect(() => { if (dragging !== undefined && !enabled) update(undefined); }, [enabled]);
  useEffect(() => () => latest.current.onScrub(undefined), []);
  const adjustable = useAdjustable({ label: 'Playback position', value: position, min: 0, max: duration || 1, step: 10,
    text: `${clock(position)} of ${clock(duration)}`, onChange: seconds => void player.seek(seconds), disabled: !enabled });
  const fill = duration ? position / duration : 0;
  const at01 = (px: number) => width ? Math.max(0, Math.min(1, px / width)) : 0;
  const head = width * fill;
  // The front of the wash fades out rather than ending in a hard line.
  const stops = dragging === undefined
    ? [[0, 0.11], [at01(head - 32), 0.19], [at01(head + 16), 0]]
    : [[0, 0.15], [at01(head - 1), 0.28], [at01(head + 20), 0]];
  return <View pointerEvents="box-none" style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }}
    onLayout={event => { setSize(event.nativeEvent.layout); band.current?.measureInWindow(x => { left.current = x; }); }}>
    <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, borderRadius: radius, overflow: 'hidden' }}>
      <Svg style={StyleSheet.absoluteFill} width={width} height={height}>
        <Defs><LinearGradient id="mini-wash" x1="0" y1="0" x2="1" y2="0">
          {stops.map(([offset, opacity], index) => <Stop key={index} offset={offset} stopColor={theme.accent} stopOpacity={opacity} />)}
        </LinearGradient></Defs>
        <Rect width={width} height={height} fill="url(#mini-wash)" />
      </Svg>
      {dragging !== undefined && <View style={{ position: 'absolute', top: 7, bottom: 7, left: head - 1, width: 2, borderRadius: 1, backgroundColor: theme.accent }} />}
    </View>
    <View ref={band} testID="mini-player-scrub" {...adjustable} {...responder.panHandlers}
      style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 12 }} />
  </View>;
}
