/// <reference lib="webworker" />

import { heicTo } from 'heic-to/next';

const worker = self as DedicatedWorkerGlobalScope;

worker.onmessage = async (event: MessageEvent<File>) => {
  try {
    const bitmap = await heicTo({ blob: event.data, type: 'bitmap' });
    worker.postMessage(bitmap, [bitmap]);
  } catch {
    worker.postMessage(null);
  }
};
