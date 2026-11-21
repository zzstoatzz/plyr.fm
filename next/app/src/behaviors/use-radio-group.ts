/** one choice from a few, each option pressable: the group's and each option's accessibility props */
export function useRadioGroup<T>({ label, value, onChange, disabled }: { label: string; value: T; onChange: (value: T) => void; disabled?: boolean }) {
  return {
    group: { accessibilityRole: 'radiogroup' as const, accessibilityLabel: label },
    option: (option: T) => ({
      accessibilityRole: 'radio' as const, accessibilityState: { checked: option === value, disabled }, disabled, onPress: () => onChange(option),
    }),
  };
}
