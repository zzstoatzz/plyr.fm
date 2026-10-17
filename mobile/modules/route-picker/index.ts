import { requireNativeView } from "expo";
import type { ColorValue, ViewProps } from "react-native";

export type RoutePickerProps = ViewProps & {
  tint?: ColorValue;
  /** The glyph's color while audio is going somewhere other than this phone. */
  activeTint?: ColorValue;
};

/** The system's audio output button: tapping it opens the AirPlay and Bluetooth route sheet. */
export const RoutePicker = requireNativeView<RoutePickerProps>("RoutePicker");
