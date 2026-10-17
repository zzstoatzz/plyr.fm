import { Storage } from "expo-sqlite/kv-store";
import { restoreSettings, saveSettings, type Settings } from "plyr-shared/settings";
import { useSyncExternalStore } from "react";
import { accentColors } from "./theme";

const KEY = "settings";

function recall(): Settings {
  try {
    return restoreSettings(Storage.getItemSync(KEY));
  } catch {
    return restoreSettings(null);
  }
}

// kept on this device only; the field names are the web's, so they can become the account's once the app signs in
let settings = recall();
const listeners = new Set<() => void>();

export const currentSettings = (): Settings => settings;

export function changeSettings(change: (now: Settings) => Settings): void {
  const next = change(settings);
  if (next === settings) return;
  settings = next;
  void Storage.setItem(KEY, saveSettings(next)).catch(() => {});
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useSettings(): Settings {
  return useSyncExternalStore(subscribe, currentSettings);
}

/** The accent in the listener's chosen color, plus its tints and the playing edge line. */
export function useAccent() {
  return accentColors(useSettings().accent_color);
}
