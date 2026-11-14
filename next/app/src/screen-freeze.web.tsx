import { useNavigationState } from 'expo-router/react-navigation';
import type { ReactNode } from 'react';
import { Freeze } from 'react-freeze';

// The web stack keeps every pushed screen mounted, hidden with display: none, and
// playback state changes several times a second. Frozen, a covered screen keeps its
// DOM and state but skips those renders until it is on top again.
function Covered({ routeKey, children }: { routeKey: string; children: ReactNode }) {
  const covered = useNavigationState(state => {
    const at = state.routes.findIndex(route => route.key === routeKey);
    // Now Playing is a transparent modal: the screen under it stays on view
    const visibleBelow = state.routes[state.index]?.name === 'now-playing' ? 1 : 0;
    return at < state.index - visibleBelow;
  });
  return <Freeze freeze={covered}>{children}</Freeze>;
}

export function screenLayout({ route, children }: { route: { key: string }; children: ReactNode }) {
  return <Covered routeKey={route.key}>{children}</Covered>;
}
