import type { ReactElement, ReactNode } from 'react';

export interface PullTarget { begin(): void; update(dy: number, pointers: number): void; end(velocity: number): void }

/** Web pulls go through the sheet's pointer handlers in `usePlayerDismiss`. */
export function usePlayerPull(_enabled: boolean, _target: PullTarget) {
  return { pan: undefined, scroll: undefined };
}

export function PullRoot({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

export function PullDetector({ children }: { gesture: unknown; children: ReactElement }) {
  return children;
}
