export type Chapter = { start: number; label: string; title: string; artist?: string };

const stamp = /^\s*[[(]?((?:\d{1,2}:)?\d{1,2}:\d{2})[\])]?\s*[-–—:|.]?\s+(.+?)\s*$/;

function seconds(text: string) {
  return text.split(':').reduce((total, part) => total * 60 + Number(part), 0);
}

/** Timestamped lines ("01:35 sleepy fish - before rain") as chapters, and the rest of the description as prose.
 *  A tracklist needs at least three stamps in order, starting near the beginning and inside the track. */
export function parseChapters(description: string | null | undefined, duration?: number): { chapters: Chapter[]; prose: string } {
  const text = description?.trim() ?? '';
  const chapters: Chapter[] = [];
  const rest: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const match = stamp.exec(line);
    if (!match) { rest.push(line); continue; }
    const label = match[2];
    const parts = label.split(/\s+[-–—]\s+/);
    chapters.push({ start: seconds(match[1]), label, ...(parts.length === 2 ? { artist: parts[0], title: parts[1] } : { title: label }) });
  }
  const ordered = chapters.every((chapter, index) => index === 0 || chapter.start > chapters[index - 1].start);
  const fits = !duration || chapters.every(chapter => chapter.start < duration);
  if (chapters.length < 3 || !ordered || !fits || chapters[0].start > 60) return { chapters: [], prose: text };
  return { chapters, prose: rest.join('\n').replace(/\n{3,}/g, '\n\n').trim() };
}

/** The chapter playing at `position`, or -1 before the first. */
export function currentChapter(chapters: Chapter[], position: number) {
  let at = -1;
  for (let index = 0; index < chapters.length && chapters[index].start <= position; index++) at = index;
  return at;
}

export function clock(value: number) {
  const total = Math.max(0, Math.floor(value));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor(total % 3600 / 60);
  const secs = String(total % 60).padStart(2, '0');
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${secs}` : `${minutes}:${secs}`;
}
