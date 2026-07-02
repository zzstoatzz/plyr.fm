// test stand-in for the `$app/navigation` virtual module
import { vi } from 'vitest';

export const goto = vi.fn(() => Promise.resolve());
export const invalidateAll = vi.fn(() => Promise.resolve());
export const replaceState = vi.fn();
