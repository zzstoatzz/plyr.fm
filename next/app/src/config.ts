export { NSID, SITE_URL } from './auth-config';

export const API_URL = (process.env.EXPO_PUBLIC_API_URL || 'https://api.next.plyr.fm').replace(/\/$/, '');
