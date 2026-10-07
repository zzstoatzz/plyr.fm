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

/** The periods to try after `period`, in toggle order; the toggle skips any that come back empty. */
export function periodsAfter(period: TopPeriod): TopPeriod[] {
  const start = TOP_PERIODS.indexOf(period);
  return TOP_PERIODS.map((_, i) => TOP_PERIODS[(start + i + 1) % TOP_PERIODS.length]);
}

/** Query string for `GET /tracks/top`; all-time sends no period, as the web does. */
export function topTracksQuery(period: TopPeriod, limit = TOP_TRACKS_LIMIT): string {
  return period === "all_time" ? `limit=${limit}` : `limit=${limit}&period=${period}`;
}
