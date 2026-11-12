import type { Auth } from './auth-state';
import { JAM_COORDINATOR_URL, JAM_JOIN_METHOD, JAM_SERVICE_AUDIENCE } from './auth-config';
import type { JamTrack, PersonalQueueState } from './jam-connection';

export interface QueueSeed {
  queue: (JamTrack & { key: string })[];
  index: number;
  playing: boolean;
  positionMs: number;
  personal: Pick<PersonalQueueState, 'explicitEnd' | 'tailKind' | 'label' | 'repeat' | 'keepPlaying' | 'cursor'>;
}

export async function joinPersonalQueue(auth: Auth, clientId: string, initial: QueueSeed | undefined, resumePlaying: boolean) {
  if (!auth.agent || !auth.did) throw new Error('sign in to save your queue across devices');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const identity = await auth.agent.handle(`/xrpc/com.atproto.server.getServiceAuth?${new URLSearchParams({ aud: JAM_SERVICE_AUDIENCE, lxm: JAM_JOIN_METHOD })}`, { signal: controller.signal });
    if (!identity.ok) throw new Error('sign in again to save your queue across devices');
    const service: unknown = await identity.json();
    if (!service || typeof service !== 'object' || !('token' in service) || typeof service.token !== 'string') throw new Error('could not authorize your queue');
    const response = await fetch(`${JAM_COORDINATOR_URL}/v1/playback/join`, {
      method: 'POST', signal: controller.signal, headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ serviceToken: service.token, clientId, initial, resumePlaying }),
    });
    const body: unknown = await response.json();
    if (!response.ok || !body || typeof body !== 'object' || !('ticket' in body) || typeof body.ticket !== 'string'
      || !('connectionId' in body) || typeof body.connectionId !== 'string') throw new Error('could not connect to your saved queue');
    const socket = new URL('/v1/jams/socket', JAM_COORDINATOR_URL);
    socket.protocol = socket.protocol === 'https:' ? 'wss:' : 'ws:';
    socket.searchParams.set('ticket', body.ticket);
    return { ticket: body.ticket, websocketUrl: socket.toString(), connectionId: body.connectionId };
  } finally { clearTimeout(timer); }
}
