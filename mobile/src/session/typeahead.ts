import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { TYPEAHEAD_CLIENT, TYPEAHEAD_MIN_LENGTH, TYPEAHEAD_ORIGIN, normalizeIdentifier, parseActors, typeaheadPath } from "plyr-shared/account";
import { useEffect, useState } from "react";

function useSettled<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}

/**
 * People whose handle or name starts like what was typed. A request that is no longer wanted is aborted by the
 * query's signal, and the last answer stays on screen while the next one loads, so the list never blinks empty.
 */
export function useActorSuggestions(typed: string) {
  const query = useSettled(normalizeIdentifier(typed), 150);
  const wanted = query.length >= TYPEAHEAD_MIN_LENGTH && !query.startsWith("did:");
  const found = useQuery({
    queryKey: ["typeahead", query],
    enabled: wanted,
    staleTime: 5 * 60_000,
    retry: false,
    placeholderData: keepPreviousData,
    queryFn: async ({ signal }) => {
      const response = await fetch(TYPEAHEAD_ORIGIN + typeaheadPath(query), {
        signal,
        headers: { "X-Client": TYPEAHEAD_CLIENT },
      });
      if (!response.ok) throw new Error(`typeahead ${response.status}`);
      return parseActors(await response.json());
    },
  });
  return { query, actors: wanted ? (found.data ?? []) : [] };
}
