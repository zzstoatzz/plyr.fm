import type { AtlasCallbacks, AtlasData, AtlasOptions } from './types';

/** The atlas draws on a canvas, which only the web build has. */
export class AtlasRenderer {
  constructor(_canvas: unknown, _callbacks: AtlasCallbacks, _options: AtlasOptions) {
    throw new Error('the atlas is only on the web for now');
  }
  setData(_data: AtlasData): void {}
  setDark(_dark: boolean): void {}
  zoomBy(_factor: number): void {}
  panBy(_dx: number, _dy: number): void {}
  flyTo(_x: number, _y: number, _zoom: number): void {}
  destroy(): void {}
}
