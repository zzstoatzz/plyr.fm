import { error } from '@sveltejs/kit';
import { radioStationBySlug } from '@plyr/next-core/radio';
import type { PageLoad } from './$types';

/** `/radio/{station}` is a station's shareable link (production's path too); bare `/radio` is the lineup. */
export const load: PageLoad = ({ params }) => {
  if (!params.station) return { station: null };
  const station = radioStationBySlug(params.station);
  if (!station) error(404, "we couldn't find that station");
  return { station };
};
