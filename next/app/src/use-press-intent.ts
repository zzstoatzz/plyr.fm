import { useEffect, useRef } from 'react';

export function usePressIntent(onPress: (() => void) | undefined) {
  const captured = useRef<{ callback: (() => void) | undefined } | undefined>(undefined);
  const expiry = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(expiry.current), []);
  return {
    onPointerDown() {
      clearTimeout(expiry.current);
      captured.current = { callback: onPress };
    },
    onPressIn() {
      clearTimeout(expiry.current);
      captured.current ??= { callback: onPress };
    },
    onPressOut() {
      clearTimeout(expiry.current);
      expiry.current = setTimeout(() => { captured.current = undefined; }, 0);
    },
    onPress() {
      clearTimeout(expiry.current);
      const intent = captured.current;
      captured.current = undefined;
      (intent ? intent.callback : onPress)?.();
    }
  };
}
