export function createLayerStack() {
  let layers: symbol[] = [];
  return {
    open() {
      const layer = Symbol('layer');
      layers = [...layers, layer];
      return () => { layers = layers.filter(other => other !== layer); };
    },
    isOpen: () => layers.length > 0,
  };
}

export const layers = createLayerStack();
