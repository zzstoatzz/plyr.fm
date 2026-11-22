import { useEffect, useState } from 'react';
import { Keyboard, LayoutAnimation, Platform, useWindowDimensions } from 'react-native';

/**
 * How much of the window's bottom edge the keyboard covers. Measured against the window, so a window
 * that resizes for the keyboard itself reports no overlap and nothing is counted twice.
 */
export function useKeyboardInset(enabled: boolean) {
  const { height } = useWindowDimensions();
  const [inset, setInset] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const ios = Platform.OS === 'ios';
    const move = (next: number, duration: number) => {
      if (ios && duration) LayoutAnimation.configureNext(LayoutAnimation.create(duration, 'keyboard', 'opacity'));
      setInset(next);
    };
    const change = Keyboard.addListener(ios ? 'keyboardWillChangeFrame' : 'keyboardDidShow', event => move(Math.max(0, height - event.endCoordinates.screenY), event.duration));
    const hide = Keyboard.addListener(ios ? 'keyboardWillHide' : 'keyboardDidHide', event => move(0, event.duration));
    return () => { change.remove(); hide.remove(); };
  }, [enabled, height]);
  return enabled ? inset : 0;
}
