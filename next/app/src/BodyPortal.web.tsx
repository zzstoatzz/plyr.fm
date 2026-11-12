import type { ReactNode, ReactPortal } from 'react';
// @ts-expect-error react-dom ships without type declarations in this project
import { createPortal } from 'react-dom';

export function BodyPortal({ children }: { children: ReactNode }) {
  return (createPortal as (node: ReactNode, container: Element) => ReactPortal)(children, document.body);
}
