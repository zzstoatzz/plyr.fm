import NativeSlider, { type SliderProps } from '@react-native-community/slider';
import { useAppearance } from './appearance';

export default function Slider(props: SliderProps) {
  const theme = useAppearance();
  return <NativeSlider minimumTrackTintColor={theme.accent} maximumTrackTintColor={theme.border} thumbTintColor={theme.accent} {...props} />;
}
