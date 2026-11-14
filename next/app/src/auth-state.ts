import { useSyncExternalStore } from 'react';
import { Client } from '@atcute/client';
import { createAuthState, type Auth as SharedAuth } from '../../core/src/auth-state';
import * as config from './auth-config';

export type { Agent, Did } from '../../core/src/auth-state';
export { resolveHandle } from '../../core/src/auth-state';

export type Auth = SharedAuth<Client>;
const { subscribe, initial, clearAuth, getAuth, setAuth, scopeFor } = createAuthState(config, handler => new Client({ handler }));
export { clearAuth, getAuth, setAuth, scopeFor };

export function useAuth(): Auth {
	return useSyncExternalStore(subscribe, getAuth, () => initial);
}
