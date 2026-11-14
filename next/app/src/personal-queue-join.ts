import { createQueueAdmission } from '../../core/src/personal-queue-join';
import * as config from './auth-config';
import { coordinatorHeaders } from './coordinator-origin';

export const joinPersonalQueue = createQueueAdmission(config, coordinatorHeaders);
