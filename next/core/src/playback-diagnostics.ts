/**
 * A short on-device record of recent playback attempts, so a failure on a phone
 * can be read without a cable: settings shares it as text. Nothing leaves the
 * device unless the listener shares it.
 */
export type DiagnosticFields = Record<string, string | number | boolean | null | undefined>;
export interface DiagnosticEvent { at: number; event: string; fields: DiagnosticFields }

const LIMIT = 80;
const events: DiagnosticEvent[] = [];

export function recordPlayback(event: string, fields: DiagnosticFields = {}, at = Date.now()) {
  events.push({ at, event, fields });
  if (events.length > LIMIT) events.splice(0, events.length - LIMIT);
}

export function playbackEvents(): readonly DiagnosticEvent[] {
  return events;
}

export function clearPlaybackEvents() {
  events.length = 0;
}

/** The host of a URL, or `null` for anything that isn't one; full URLs can carry signatures. */
export function urlHost(url: string | undefined | null): string | null {
  if (!url) return null;
  try { return new URL(url).host; } catch { return null; }
}

export function formatPlaybackEvents(list: readonly DiagnosticEvent[], header: DiagnosticFields = {}): string {
  const line = (fields: DiagnosticFields) => Object.entries(fields)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}=${value}`).join(' ');
  const head = line(header);
  return [head, ...list.map(item => `${new Date(item.at).toISOString()} ${item.event}${Object.keys(item.fields).length ? ' ' + line(item.fields) : ''}`)]
    .filter(Boolean).join('\n');
}
