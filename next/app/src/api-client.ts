import { createApi } from '@plyr/next-core/api';
import { API_URL } from './config';
import { playListenerId } from './play-listener';

export const api = createApi(API_URL, playListenerId);
