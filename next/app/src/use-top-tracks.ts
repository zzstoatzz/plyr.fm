import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type Track } from './api';
import { errorMessage } from './CatalogPieces';
import { nextPopulatedChart, type ChartPeriod } from './home-state';

/** The most-liked tracks for a period; `cycle` moves on to the next period that has any. */
export function useTopTracks(initial: ChartPeriod = 'month', limit = 10) {
  const [period, setPeriod] = useState<ChartPeriod>(initial);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const generation = useRef(0);
  const pending = useRef(false);
  const load = useCallback(async (candidate: ChartPeriod, cycle = false) => {
    if (pending.current) return;
    pending.current = true;
    const request = ++generation.current;
    setLoading(true);
    setError(undefined);
    try {
      const read = async (period: ChartPeriod) => (await api.chart(period, limit)).data.slice(0, limit).map(({ track }) => track);
      const result = cycle ? await nextPopulatedChart(candidate, read) : { period: candidate, tracks: await read(candidate) };
      if (request === generation.current) { setPeriod(result.period); setTracks(result.tracks); }
    } catch (cause) {
      if (request === generation.current) setError(errorMessage(cause));
    } finally {
      if (request === generation.current) { pending.current = false; setLoading(false); }
    }
  }, [limit]);
  useEffect(() => { void load(initial); return () => { generation.current++; pending.current = false; }; }, [load, initial]);
  return { period, tracks, loading, error, retry: () => void load(period), cycle: () => void load(period, true) };
}
