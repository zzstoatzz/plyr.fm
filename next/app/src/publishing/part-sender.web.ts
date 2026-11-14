import { transferParts } from '../../../core/src/publishing/upload-model';

/** Browsers send parts with fetch while the tab is open. */
export const sendParts = transferParts;
