import { useId } from 'react';

export function useTabs<T extends string>({ label, value, onChange }: {
  label: string; value: T; onChange: (value: T) => void;
}) {
  const id = useId();
  return {
    list: { accessibilityRole: 'tablist' as const, accessibilityLabel: label },
    tab: (tab: T) => ({
      nativeID: `${id}tab-${tab}`, 'aria-controls': tab === value ? `${id}panel-${tab}` : undefined,
      role: 'tab' as const, label: tab, selected: tab === value, onPress: () => onChange(tab),
    }),
    panel: (tab: T) => ({ accessibilityRole: 'tabpanel' as const, nativeID: `${id}panel-${tab}`, 'aria-labelledby': `${id}tab-${tab}` }),
  };
}
