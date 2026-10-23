import { z } from "zod";

/** The accent colors the web's settings page offers; `null` in a setting means the app's own default. */
export const ACCENT_PRESETS = [
  { name: "blue", value: "#6a9fff" },
  { name: "purple", value: "#a78bfa" },
  { name: "pink", value: "#f472b6" },
  { name: "green", value: "#4ade80" },
  { name: "orange", value: "#fb923c" },
  { name: "red", value: "#ef4444" },
] as const;

/** Tags hidden from feeds until a listener says otherwise; the server applies the same list to signed-out requests. */
export const DEFAULT_HIDDEN_TAGS = ["ai", "ai-slop", "suno"] as const;

// field names are the web's preference fields, so a device's settings can become the account's once it signs in
const Settings = z.object({
  accent_color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .nullable()
    .catch(null)
    .default(null),
  hidden_tags: z
    .array(z.string())
    .catch([...DEFAULT_HIDDEN_TAGS])
    .default([...DEFAULT_HIDDEN_TAGS]),
  ui_settings: z
    .object({
      atproto_client: z.string().optional().catch(undefined),
      play_through_collections: z.boolean().optional().catch(undefined),
    })
    .catch({})
    .default({}),
});

export type Settings = z.infer<typeof Settings>;

export const DEFAULT_SETTINGS: Settings = Settings.parse({});

/** Stored settings back as a value; anything missing or malformed falls back to its default, field by field. */
export function restoreSettings(stored: string | null): Settings {
  if (!stored) return DEFAULT_SETTINGS;
  try {
    return Settings.catch(DEFAULT_SETTINGS).parse(JSON.parse(stored));
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export const saveSettings = (settings: Settings): string => JSON.stringify(settings);

/** A tag as the web stores one: trimmed, lowercase, no leading #. Empty when nothing is left. */
export const normalizeTag = (typed: string): string => typed.trim().replace(/^#+/, "").toLowerCase();

export function hideTag(settings: Settings, typed: string): Settings {
  const tag = normalizeTag(typed);
  return tag && !settings.hidden_tags.includes(tag) ? { ...settings, hidden_tags: [...settings.hidden_tags, tag] } : settings;
}

export function showTag(settings: Settings, tag: string): Settings {
  return { ...settings, hidden_tags: settings.hidden_tags.filter((hidden) => hidden !== tag) };
}

/** On unless turned off, as on the web. */
export const playsThroughCollections = (settings: Settings): boolean => settings.ui_settings.play_through_collections ?? true;

/** Whether the server's own default filter already does what this listener wants. */
export function hidesDefaultTags(settings: Settings): boolean {
  return settings.hidden_tags.length === DEFAULT_HIDDEN_TAGS.length && DEFAULT_HIDDEN_TAGS.every((tag) => settings.hidden_tags.includes(tag));
}

export function isHidden(settings: Settings, tags: readonly string[]): boolean {
  return tags.some((tag) => settings.hidden_tags.includes(tag));
}
