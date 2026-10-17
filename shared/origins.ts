export const ENVIRONMENTS = {
  production: { api: "https://api.plyr.fm", web: "https://plyr.fm" },
  staging: { api: "https://api-stg.plyr.fm", web: "https://stg.plyr.fm" },
} as const;

export type Environment = keyof typeof ENVIRONMENTS;

export function isEnvironment(value: string | undefined): value is Environment {
  return value !== undefined && value in ENVIRONMENTS;
}

