const enabled = __DEV__ || process.env.EXPO_PUBLIC_PLAYER_TIMELINE === "1";

let origin = 0;
let subject = "";
let audible = false;

/** Dev-only stage timings for one track change, as `[switch]` console lines. */
export const timeline = {
  /** A track change was asked for; every later mark is measured from here. */
  start(cause: string) {
    if (!enabled) return;
    origin = performance.now();
    subject = cause;
    audible = false;
    console.log(`[switch] ${cause} start`);
  },
  mark(stage: string, detail = "") {
    if (!enabled || origin === 0) return;
    console.log(`[switch] ${subject} ${stage} +${Math.round(performance.now() - origin)}ms${detail ? ` ${detail}` : ""}`);
  },
  /** The first position report, back-dated by the audio it says has already played. */
  position(seconds: number) {
    if (!enabled || origin === 0 || audible || seconds <= 0) return;
    audible = true;
    console.log(`[switch] ${subject} audible +${Math.round(performance.now() - origin - seconds * 1000)}ms (reported at ${seconds.toFixed(2)}s)`);
  },
};

if (enabled) {
  const plain = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const began = performance.now();
    try {
      return await plain(input, init);
    } finally {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("/audio/")) timeline.mark(`http ${init?.method ?? "GET"} ${new URL(url).host}`, `took ${Math.round(performance.now() - began)}ms`);
    }
  };
}
