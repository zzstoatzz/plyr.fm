import { createContext, useContext } from 'react';
import type { usePreferences } from './preferences';

const Preferences = createContext<ReturnType<typeof usePreferences> | null>(null);
export const PreferencesProvider = Preferences.Provider;

export function useAppPreferences() {
  const value = useContext(Preferences);
  if (!value) throw new Error('preferences provider is missing');
  return value;
}
