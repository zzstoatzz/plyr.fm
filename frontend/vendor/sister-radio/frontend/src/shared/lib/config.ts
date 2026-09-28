export const API_BASE = import.meta.env.VITE_API_BASE ?? ''
// Standalone bundles must stay domain-free: VITE_BASE_URL is only consumed by
// the client-metadata.json build step, never compiled into the client.
export const BASE_URL = import.meta.env.VITE_STANDALONE === 'true' ? '' : (import.meta.env.VITE_BASE_URL ?? '')
export const RADIO_SERVICE_DID = import.meta.env.VITE_RADIO_SERVICE_DID ?? ''
export const RADIO_SERVICE_ID = import.meta.env.VITE_RADIO_SERVICE_ID ?? '#radio_xrpc'
export const SYNDICATION_WORKER_BASE = ''
export const STANDALONE = import.meta.env.VITE_STANDALONE === 'true'
