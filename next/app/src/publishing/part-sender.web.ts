import { transferParts } from '@plyr/next-core/publishing/upload-model';

/** Browsers send parts with fetch while the tab is open. */
export const sendParts = transferParts;
