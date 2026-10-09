import * as Haptics from "expo-haptics";

const quiet = () => {};

/**
 * The app's feedback, by what happened rather than by strength. Only where a control of ours does something the
 * finger cannot see; system controls (tab bar, slider, pull to refresh, menus) keep their own.
 */
export const haptic = {
  /** A transport control took effect: play, pause, skip. */
  tap: () => void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(quiet),
  /** A choice changed or an item settled in a new place: repeat, a tag filter, a dropped queue row. */
  selection: () => void Haptics.selectionAsync().catch(quiet),
  /** Something was done for later: queued, sleep timer set. */
  success: () => void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(quiet),
};

export type Feedback = keyof typeof haptic;
