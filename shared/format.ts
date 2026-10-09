/** 0:07, 3:21, 1:02:09. Unknown or negative time reads as 0:00. */
export function formatTime(seconds: number): string {
  const total = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}


/** "1 track", "3 tracks", as the web counts things. */
export function count(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** Who made a track: the artist, then anyone featured. */
export function credits(track: { artist: string; features: readonly { display_name: string }[] }): string {
  return [track.artist, ...track.features.map((f) => f.display_name)].join(", ");
}
