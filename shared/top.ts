// same periods, labels and default as the "top tracks" toggle in frontend/src/routes/+page.svelte
export const TOP_PERIODS = ["all_time", "month", "week", "day"] as const;
export type TopPeriod = (typeof TOP_PERIODS)[number];

export const TOP_PERIOD_LABELS = {
  all_time: "all time",
  month: "past month",
  week: "past week",
  day: "past day",
} as const satisfies Record<TopPeriod, string>;

export const DEFAULT_TOP_PERIOD: TopPeriod = "month";
export const TOP_TRACKS_LIMIT = 10;

/** The most `GET /tracks/top` returns; it has no offset, so a chart is at most this long. */
export const TOP_CHART_LIMIT = 50;

/** The search tab's charts, shortest window first: each continues the one before it. */
export const CHART_PERIODS = ["week", "month", "all_time"] as const satisfies readonly TopPeriod[];

export const CHART_TITLES = {
  week: "top this week",
  month: "top this month",
  all_time: "top of all time",
} as const satisfies Record<(typeof CHART_PERIODS)[number], string>;

/** Each chart without the tracks an earlier one already listed; a chart left empty is dropped. */
export function chartSections<T extends { id: number }>(charts: readonly { title: string; tracks: readonly T[] }[]): { title: string; tracks: T[] }[] {
  const seen = new Set<number>();
  return charts
    .map(({ title, tracks }) => {
      const fresh = tracks.filter((track) => !seen.has(track.id));
      for (const track of fresh) seen.add(track.id);
      return { title, tracks: fresh };
    })
    .filter((chart) => chart.tracks.length > 0);
}

/** The periods to try after `period`, in toggle order; the toggle skips any that come back empty. */
export function periodsAfter(period: TopPeriod): TopPeriod[] {
  const start = TOP_PERIODS.indexOf(period);
  return TOP_PERIODS.map((_, i) => TOP_PERIODS[(start + i + 1) % TOP_PERIODS.length]);
}

/** Query string for `GET /tracks/top`; all-time sends no period, as the web does. */
export function topTracksQuery(period: TopPeriod, limit = TOP_TRACKS_LIMIT): string {
  return period === "all_time" ? `limit=${limit}` : `limit=${limit}&period=${period}`;
}
