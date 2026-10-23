import { requireNativeView } from "expo";
import type { ViewProps } from "react-native";

/** Wraps the part of a sheet where a drag must not pull the sheet down. */
export const SheetGuard = requireNativeView<ViewProps>("SheetGuard");
