import { createPrivateCreateStorage } from '../../../web/src/lib/storage/private-create-storage';
import { privateLibrary } from './private-config';

export const privateCreateStorage = createPrivateCreateStorage(privateLibrary);
