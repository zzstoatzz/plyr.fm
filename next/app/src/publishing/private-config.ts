import { createPrivateLibrary } from '@plyr/next-core/publishing/private-music';
import * as config from '../auth-config.ts';

export const privateLibrary = createPrivateLibrary(config);
