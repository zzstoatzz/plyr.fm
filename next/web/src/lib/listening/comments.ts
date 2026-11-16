import { createTrackComments } from '@plyr/next-core/track-comments';
import { api } from '$lib/api';
import { auth } from '$lib/auth';
import { createPds } from '$lib/pds';

export const comments = createTrackComments({ api, getAuth: auth.getAuth, createPds });
