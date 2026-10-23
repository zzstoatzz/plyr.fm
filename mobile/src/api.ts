import type { Body } from "plyr-shared/contract";
import { API } from "./config";

export class HttpError extends Error {
  constructor(readonly status: number) {
    super(status === 503 ? "plyr.fm is busy" : `request failed (${status})`);
  }
}

/** Turns a decoded JSON body into a validated value (see plyr-shared/contract). */
export type Parser<T> = (body: Body) => T;

async function send(path: string, init: RequestInit & { timeout?: number } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), init.timeout ?? 20000);
  init.signal?.addEventListener("abort", () => controller.abort());
  try {
    return await fetch(API + path, {
      ...init,
      signal: controller.signal,
      headers: { Accept: "application/json", ...init.headers },
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function getJSON<T>(path: string, parse: Parser<T>, signal?: AbortSignal): Promise<T> {
  const response = await send(path, { signal });
  if (!response.ok) throw new HttpError(response.status);
  return parse(await response.json());
}

/** Fire-and-forget write; a failure here never interrupts playback. */
export async function post(path: string, body?: object): Promise<void> {
  try {
    await send(path, {
      method: "POST",
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {}
}
