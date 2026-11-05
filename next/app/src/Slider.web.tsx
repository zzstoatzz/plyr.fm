import NativeSlider, { type SliderProps } from '@react-native-community/slider';
import { useEffect, useState } from 'react';
import { useAppearance } from './appearance';
import type { KeyDownEvent } from 'react-native';

export default function Slider(props: SliderProps) {
  const theme = useAppearance();
  const { minimumValue = 0, maximumValue = 1, value = 0, disabled, onValueChange, onSlidingStart, onSlidingComplete } = props;
  const [current, setCurrent] = useState(value);
  useEffect(() => setCurrent(value), [value]);
  return <NativeSlider minimumTrackTintColor={theme.accent} maximumTrackTintColor={theme.border} thumbTintColor={theme.accent} {...props} value={current} tabIndex={disabled ? -1 : 0}
    aria-valuemin={minimumValue} aria-valuemax={maximumValue} aria-valuenow={current} aria-disabled={disabled}
    onValueChange={next => { setCurrent(next); onValueChange?.(next); }}
    {...{ onKeyDown: (event: KeyDownEvent) => {
      if (disabled) return;
      const key = event.nativeEvent.key;
      const step = props.step || (maximumValue <= 1 ? 0.01 : 1);
      const changes: Record<string, number> = { ArrowRight: step, ArrowUp: step, ArrowLeft: -step, ArrowDown: -step, PageUp: step * 10, PageDown: -step * 10 };
      if (!(key in changes) && key !== 'Home' && key !== 'End') return;
      event.preventDefault();
      const next = Math.max(minimumValue, Math.min(maximumValue, key === 'Home' ? minimumValue : key === 'End' ? maximumValue : current + changes[key]));
      onSlidingStart?.(current);
      setCurrent(next);
      onValueChange?.(next);
      onSlidingComplete?.(next);
    } }} />;
}
