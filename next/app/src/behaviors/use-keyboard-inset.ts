import { useEffect, useState } from 'react';
import { Keyboard, LayoutAnimation, Platform, useWindowDimensions } from 'react-native';

/** How much of the window's bottom edge the iOS keyboard covers, animated with the keyboard. Android resizes the window itself. */
export function useKeyboardInset(enabled: boolean) {
  const { height } = useWindowDimensions();
  const [inset, setInset] = useState(0);
  useEffect(() => {
    if (!enabled || Platform.OS !== 'ios') return;
    const move = (next: number, duration: number) => {
      if (duration) LayoutAnimation.configureNext(LayoutAnimation.create(duration, 'keyboard', 'opacity'));
      setInset(next);
    };
    const change = Keyboard.addListener('keyboardWillChangeFrame', event => move(Math.max(0, height - event.endCoordinates.screenY), event.duration));
    const hide = Keyboard.addListener('keyboardWillHide', event => move(0, event.duration));
    return () => { change.remove(); hide.remove(); };
  }, [enabled, height]);
  return enabled ? inset : 0;
}
