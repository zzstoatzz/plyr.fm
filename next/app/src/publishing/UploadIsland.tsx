import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, useWindowDimensions, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppearance } from '../appearance';
import { ArrowUp, Check, Warning } from '../icons';
import { Text } from '../Text';
import { useUploadIsland, type IslandShown } from './upload-island-store';

// The Dynamic Island's own size and place, so the pill reads as the island growing (as noti does for refresh).
const ISLAND = { width: 126, height: 37, top: 11 };
const WING = 72;
const PAD = 16;
const hasIsland = (topInset: number) => topInset >= 59;

/** True while the island is out on a Dynamic Island phone, so the shell can step the status bar aside like a real Live Activity. */
export function useIslandHidesStatusBar() {
  const current = useUploadIsland();
  return !!current && hasIsland(useSafeAreaInsets().top);
}

/** Upload steps drawn over the Dynamic Island, or as a pill under the status bar on phones without one. */
export function UploadIslandHost() {
  const current = useUploadIsland();
  const theme = useAppearance();
  const insets = useSafeAreaInsets();
  const { width: screen } = useWindowDimensions();
  const island = hasIsland(insets.top);
  const [shown, setShown] = useState<IslandShown | null>(null);
  const grow = useRef(new Animated.Value(0)).current;
  const content = useRef(new Animated.Value(0)).current;
  const lastPhase = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (current) setShown(current);
    const open = !!current;
    if (theme.reduceMotion) {
      grow.setValue(open ? 1 : 0);
      content.setValue(open ? 1 : 0);
      if (!open) setShown(null);
      return;
    }
    if (open) {
      Animated.parallel([
        Animated.spring(grow, { toValue: 1, damping: 18, stiffness: 220, mass: 0.8, useNativeDriver: false }),
        Animated.timing(content, { toValue: 1, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: false }),
      ]).start();
    } else {
      Animated.sequence([
        Animated.timing(content, { toValue: 0, duration: 140, useNativeDriver: false }),
        Animated.spring(grow, { toValue: 0, damping: 18, stiffness: 220, mass: 0.8, useNativeDriver: false }),
      ]).start(({ finished }) => { if (finished) setShown(null); });
    }
  }, [current, island, theme.reduceMotion, grow, content]);

  useEffect(() => {
    if (!current || current.phase === lastPhase.current) return;
    lastPhase.current = current.phase;
    if (current.phase === 'done') { void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined); AccessibilityInfo.announceForAccessibility(current.announce); }
    if (current.phase === 'failed') { void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => undefined); AccessibilityInfo.announceForAccessibility(current.announce); }
  }, [current]);
  useEffect(() => { if (!current) lastPhase.current = undefined; }, [current]);

  if (!shown) return null;
  const wide = Math.min(screen - 24, ISLAND.width + 2 * WING);
  const width = grow.interpolate({ inputRange: [0, 1], outputRange: [island ? ISLAND.width : wide * 0.6, wide] });
  const height = grow.interpolate({ inputRange: [0, 1], outputRange: [ISLAND.height, 40] });
  const tint = shown.phase === 'done' ? '#91e5b2' : shown.phase === 'failed' ? '#f2c078' : '#ffffff';
  const Glyph = shown.phase === 'done' ? Check : shown.phase === 'failed' ? Warning : ArrowUp;
  return <View pointerEvents="none" style={{ position: 'absolute', top: island ? ISLAND.top : insets.top + 6, left: 0, right: 0, alignItems: 'center', zIndex: 1000 }}>
    <Animated.View accessible accessibilityRole="progressbar" accessibilityLabel={shown.announce}
      accessibilityValue={shown.progress === undefined ? undefined : { min: 0, max: 100, now: Math.round(shown.progress * 100) }}
      style={{ width, height, borderRadius: 20, backgroundColor: '#000000', overflow: 'hidden', alignItems: 'center', justifyContent: 'center', opacity: island ? 1 : grow }}>
      {/* Laid out at full width from the start; the pill grows to reveal it, so the glyphs never render squeezed. */}
      <Animated.View style={{ width: wide, height: 40, flexShrink: 0, flexDirection: 'row', alignItems: 'center', paddingHorizontal: PAD, opacity: content }}>
        <View style={{ width: WING - PAD, flexShrink: 0, flexDirection: 'row', alignItems: 'center' }}>
          <View style={{ width: 20, height: 20, flexShrink: 0, alignItems: 'center', justifyContent: 'center' }}><Glyph size={17} color={tint} weight="bold" /></View>
        </View>
        {island ? <View style={{ width: ISLAND.width, flexShrink: 0 }} /> : <View style={{ flex: 1 }} />}
        <View style={{ flexShrink: 0, width: island ? WING - PAD : undefined, alignItems: 'flex-end' }}>
          <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}
            style={{ color: shown.phase === 'failed' ? '#f2c078' : '#ffffff', fontSize: 12, fontWeight: '600', paddingRight: 3, fontVariant: ['tabular-nums'] }}>{shown.summary}</Text>
        </View>
      </Animated.View>
      {shown.progress !== undefined && <View style={{ position: 'absolute', left: 18, right: 18, bottom: 3, height: 2, borderRadius: 1, backgroundColor: '#ffffff26' }}>
        <View style={{ width: `${Math.round(shown.progress * 100)}%`, height: 2, borderRadius: 1, backgroundColor: theme.accent }} />
      </View>}
    </Animated.View>
  </View>;
}
