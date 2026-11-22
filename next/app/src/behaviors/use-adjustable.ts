/** a value a screen reader nudges with swipe up/down: the control's accessibility props */
export function useAdjustable({ label, value, min, max, step, text, onChange, disabled }: {
  label: string; value: number; min: number; max: number; step: number; text: string; onChange: (value: number) => void; disabled?: boolean;
}) {
  const nudge = (direction: number) => { if (!disabled) onChange(Math.max(min, Math.min(max, value + direction * step))); };
  return {
    accessible: true, accessibilityRole: 'adjustable' as const, accessibilityLabel: label, accessibilityState: { disabled },
    accessibilityValue: { min: Math.round(min), max: Math.round(max), now: Math.round(value), text },
    accessibilityActions: [{ name: 'increment' as const }, { name: 'decrement' as const }],
    onAccessibilityAction: (event: { nativeEvent: { actionName: string } }) => nudge(event.nativeEvent.actionName === 'increment' ? 1 : event.nativeEvent.actionName === 'decrement' ? -1 : 0),
  };
}
