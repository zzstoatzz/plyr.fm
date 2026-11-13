import { Platform, type AccessibilityActionEvent, type KeyDownEvent } from 'react-native';
import { stepForKey } from './reorder';

export function useReorderHandle({ label, position, total, moving, move }: {
  label: string; position: number; total: number; moving: boolean; move: (delta: number) => void;
}) {
  const text = moving ? 'Moving' : `position ${position} of ${total}`;
  const actions = [
    ...(position > 1 ? [{ name: 'decrement', label: 'move earlier' }] : []),
    ...(position < total ? [{ name: 'increment', label: 'move later' }] : []),
  ];
  function onAccessibilityAction(event: AccessibilityActionEvent) {
    const name = event.nativeEvent.actionName;
    if (actions.some(action => action.name === name)) move(name === 'decrement' ? -1 : 1);
  }
  function onKeyDown(event: KeyDownEvent) {
    const delta = stepForKey(event.nativeEvent.key, position, total);
    if (delta === null) return;
    event.preventDefault();
    move(delta);
  }
  return {
    accessible: true, focusable: true, tabIndex: 0 as const,
    accessibilityRole: 'adjustable' as const, accessibilityLabel: `Reorder ${label}`,
    accessibilityHint: Platform.OS === 'web' ? 'drag to reorder, or use the arrow keys, Home and End.' : 'drag to reorder, or use the move earlier and move later actions.',
    'aria-valuemin': 1, 'aria-valuemax': total, 'aria-valuenow': position, 'aria-valuetext': text,
    accessibilityValue: { min: 1, max: total, now: position, text },
    accessibilityActions: actions, onAccessibilityAction,
    ...(Platform.OS === 'web' ? { onKeyDown } : {}),
  };
}
