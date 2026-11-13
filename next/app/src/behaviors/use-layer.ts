import { useEffect } from 'react';
import { layers } from './layers';

export function useLayer(active: boolean) {
  useEffect(() => active ? layers.open() : undefined, [active]);
}
