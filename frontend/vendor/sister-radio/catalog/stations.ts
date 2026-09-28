export const stations = [
  { slug: 'loved', name: 'loved', description: 'the most-loved tracks on plyr.fm' },
  { slug: 'fresh', name: 'fresh', description: 'the newest uploads on plyr.fm' },
  { slug: 'deep-cuts', name: 'deep cuts', description: 'underplayed tracks from the back catalog' },
  { slug: 'slop', name: 'slop', description: 'ai-generated tracks' },
  { slug: 'firehose', name: 'firehose', description: 'archived firehose recordings on plyr.fm · live relay disabled in this preview' },
] as const

export type StationSlug = typeof stations[number]['slug']

export function isStationSlug(value: string): value is StationSlug {
  return stations.some((station) => station.slug === value)
}
