import { useEffect, useId, useRef } from 'react';
import { Platform, type KeyDownEvent, type ViewInstance } from 'react-native';
import { tabForKey } from './tabs';

export function useTabs<T extends string>({ label, values, value, onChange }: {
  label: string; values: readonly T[]; value: T; onChange: (value: T) => void;
}) {
  const id = useId();
  const elements = useRef(new Map<T, ViewInstance | null>());
  const pendingFocus = useRef<T | null>(null);
  useEffect(() => {
    const target = pendingFocus.current;
    if (target === null) return;
    const frame = requestAnimationFrame(() => {
      elements.current.get(target)?.focus();
      pendingFocus.current = null;
    });
    return () => cancelAnimationFrame(frame);
  }, [value]);
  function onKeyDown(event: KeyDownEvent) {
    const next = tabForKey(values, value, event.nativeEvent.key);
    if (next === null) return;
    event.preventDefault();
    if (next === value) {
      elements.current.get(next)?.focus();
      return;
    }
    pendingFocus.current = next;
    onChange(next);
  }
  return {
    list: { accessibilityRole: 'tablist' as const, accessibilityLabel: label, ...(Platform.OS === 'web' ? { onKeyDown } : {}) },
    tab: (tab: T) => ({
      ref: (node: ViewInstance | null) => { elements.current.set(tab, node); },
      nativeID: `${id}tab-${tab}`, 'aria-controls': tab === value ? `${id}panel-${tab}` : undefined,
      role: 'tab' as const, label: tab, selected: tab === value, onPress: () => onChange(tab),
    }),
    panel: (tab: T) => ({ accessibilityRole: 'tabpanel' as const, nativeID: `${id}panel-${tab}`, 'aria-labelledby': `${id}tab-${tab}` }),
  };
}
