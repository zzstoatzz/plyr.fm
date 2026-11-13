/** Browsers send the page's Origin on both the admission request and the socket. */
export const coordinatorHeaders: Record<string, string> = {};

export function openCoordinatorSocket(url: string): WebSocket {
  return new WebSocket(url);
}
