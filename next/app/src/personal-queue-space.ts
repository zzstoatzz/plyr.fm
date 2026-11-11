import type { Auth } from './auth-state';
import { JAM_COORDINATOR_URL, JAM_JOIN_METHOD, JAM_SERVICE_AUDIENCE, JAM_SPACE } from './auth-config';
import type { JamTrack, PersonalQueueState } from './jam-connection';

export const PERSONAL_QUEUE_KEY = 'personal-queue';
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
  const space = `at://${auth.did}/space/${JAM_SPACE.type}/${PERSONAL_QUEUE_KEY}`;
  try {
    const known = await auth.agent.handle(`/xrpc/com.atproto.space.getSpace?${new URLSearchParams({ space })}`, { signal: controller.signal });
    if (!known.ok) {
      const body: unknown = await known.json();
      if (!body || typeof body !== 'object' || !('error' in body) || body.error !== 'SpaceNotFound') throw new Error('could not open your saved queue');
      const created = await auth.agent.handle('/xrpc/com.atproto.space.createSpace', {
        method: 'POST', signal: controller.signal, headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ spaceType: JAM_SPACE.type, skey: PERSONAL_QUEUE_KEY,
          policy: { $type: 'com.atproto.memberspace.policy', publicRead: false, publicWrite: false, publishPolicy: false, publishMembers: false } }),
      });
      if (!created.ok) {
        const raced = await auth.agent.handle(`/xrpc/com.atproto.space.getSpace?${new URLSearchParams({ space })}`, { signal: controller.signal });
        if (!raced.ok) throw new Error('could not create your saved queue');
      }
    }
    const [identity, delegated] = await Promise.all([
      auth.agent.handle(`/xrpc/com.atproto.server.getServiceAuth?${new URLSearchParams({ aud: JAM_SERVICE_AUDIENCE, lxm: JAM_JOIN_METHOD })}`, { signal: controller.signal }),
      auth.agent.handle(`/xrpc/com.atproto.space.getDelegationToken?${new URLSearchParams({ space })}`, { signal: controller.signal }),
    ]);
    if (!identity.ok || !delegated.ok) throw new Error('sign in again to save your queue across devices');
    const service: unknown = await identity.json();
    const delegation: unknown = await delegated.json();
    if (!service || typeof service !== 'object' || !('token' in service) || typeof service.token !== 'string'
      || !delegation || typeof delegation !== 'object' || !('token' in delegation) || typeof delegation.token !== 'string') throw new Error('could not authorize your queue');
    const response = await fetch(`${JAM_COORDINATOR_URL}/v1/playback/join`, {
      method: 'POST', signal: controller.signal, headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ host: auth.did, key: PERSONAL_QUEUE_KEY, serviceToken: service.token, delegationToken: delegation.token, clientId, initial, resumePlaying }),
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
