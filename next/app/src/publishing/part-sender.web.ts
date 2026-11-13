import { transferParts } from './upload-model';

/** Browsers send parts with fetch while the tab is open. */
export const sendParts = transferParts;
