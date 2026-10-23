import type { QueryClient } from "@tanstack/react-query";
import { Directory, File, Paths } from "expo-file-system";
import type { Track } from "plyr-shared/contract";
import { fetchAudioUrl } from "@/data";
import { extension, fetchesAhead, streams, totalBytes } from "./formats";
import { timeline } from "./timeline";

const KEEP_BYTES = 400 * 1024 * 1024;
const PART = ".part";

const shelf = new Directory(Paths.cache, "audio");
const fetching = new Map<string, Promise<string>>();

const name = (track: Track) => `${track.file_id}.${extension(track.file_type)}`;

/** The whole file on this device, when it has been fetched before; null otherwise. */
export function kept(track: Track): string | null {
  try {
    const file = new File(shelf, name(track));
    return file.exists ? file.uri : null;
  } catch {
    return null;
  }
}

/** Drop a kept file that would not play, so the next try fetches it again. */
export function discard(track: Track): void {
  try {
    const file = new File(shelf, name(track));
    if (file.exists) file.delete();
  } catch {
    // nothing was kept
  }
}

function prune(keep: string): void {
  try {
    const files = shelf
      .list()
      .filter((entry) => entry instanceof File)
      .filter((file) => file.name !== keep && !file.name.endsWith(PART))
      .map((file) => ({ file, size: file.size, modified: file.info().modificationTime ?? 0 }))
      .sort((a, b) => b.modified - a.modified);
    let total = new File(shelf, keep).size;
    for (const { file, size } of files) {
      total += size;
      if (total > KEEP_BYTES) file.delete();
    }
  } catch {
    // the system clears the cache directory when it needs the space
  }
}

function fetchWhole(url: string, track: Track): Promise<string> {
  const key = name(track);
  const running = fetching.get(key);
  if (running) return running;
  const started = (async () => {
    shelf.create({ idempotent: true, intermediates: true });
    const part = new File(shelf, key + PART);
    if (part.exists) part.delete();
    const whole = await File.downloadFileAsync(url, part);
    whole.rename(key);
    timeline.mark("file:kept", `${key} ${Math.round(whole.size / 1024)}KB`);
    prune(key);
    return whole.uri;
  })().finally(() => fetching.delete(key));
  fetching.set(key, started);
  return started;
}

async function sizeOf(url: string): Promise<number | null> {
  try {
    const response = await fetch(url, { headers: { Range: "bytes=0-0" } });
    return totalBytes(response.headers.get("Content-Range"));
  } catch {
    return null;
  }
}

/** Where a track plays from: its kept file, a URL when the format streams, otherwise a file fetched whole first. */
export async function locate(client: QueryClient, track: Track): Promise<string> {
  const file = kept(track);
  if (file) return file;
  const url = await fetchAudioUrl(client, track.file_id);
  return streams(track.file_type) ? url : fetchWhole(url, track);
}

/** The next track as a file fetched before it is asked for, so starting it touches no network; null when it is too large. */
export async function fetchAhead(client: QueryClient, track: Track): Promise<string | null> {
  const file = kept(track);
  if (file) return file;
  const url = await fetchAudioUrl(client, track.file_id);
  const bytes = await sizeOf(url);
  return bytes !== null && fetchesAhead(track.file_type, bytes) ? fetchWhole(url, track) : null;
}
