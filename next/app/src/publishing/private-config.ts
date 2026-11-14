import { createPrivateLibrary } from '../../../core/src/publishing/private-music.ts';
import * as config from '../auth-config.ts';

export const privateLibrary = createPrivateLibrary(config);
