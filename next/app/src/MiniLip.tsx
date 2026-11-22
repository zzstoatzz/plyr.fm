import { clock } from '@plyr/next-core/chapters';
import { useEffect, useMemo, useRef, useState } from 'react';
import { PanResponder, View, type ViewInstance } from 'react-native';
import { useAppearance } from './appearance';
import { useAdjustable } from './behaviors/use-adjustable';
import { usePlayback } from './playback';

/** The mini player's progress drawn as its own bottom edge. A sideways drag on the edge scrubs; taps and vertical swipes don't. */
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
  const thick = dragging === undefined ? 2 : 4;
  const edge = (color: string) => ({ position: 'absolute' as const, left: 0, top: 0, bottom: 0, width, borderRadius: radius, borderColor: 'transparent', borderBottomWidth: thick, borderBottomColor: color });
  return <View pointerEvents="box-none" style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }}
    onLayout={event => { setSize(event.nativeEvent.layout); band.current?.measureInWindow(x => { left.current = x; }); }}>
    <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, borderRadius: radius, overflow: 'hidden' }}>
      <View style={edge(theme.line)} />
      <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: width * fill, overflow: 'hidden' }}><View style={edge(theme.accent)} /></View>
      {dragging !== undefined && <View style={{ position: 'absolute', bottom: 0, left: width * fill - 7, width: 14, height: 14, borderRadius: 7, backgroundColor: theme.accent }} />}
    </View>
    <View ref={band} testID="mini-player-scrub" {...adjustable} {...responder.panHandlers}
      style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 12 }} />
  </View>;
}
