import { SITE_URL } from './auth-config';

/**
 * The jam coordinator binds each admission ticket to the request's Origin and
 * requires the socket handshake to carry the same allowed Origin. Native fetch
 * sends none, while React Native's iOS WebSocket invents one from the socket URL,
 * so both carry the site's origin explicitly here.
 */
export const coordinatorHeaders: Record<string, string> = { Origin: SITE_URL };

export function openCoordinatorSocket(url: string): WebSocket {
  // React Native's WebSocket takes headers as a third argument; the DOM type doesn't declare it.
  const Socket = WebSocket as unknown as new (url: string, protocols: undefined, options: { headers: Record<string, string> }) => WebSocket;
  return new Socket(url, undefined, { headers: { origin: SITE_URL } });
}
