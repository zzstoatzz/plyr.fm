import type { P256Keypair } from '@atproto/crypto';
import { isCid, isLexMap, type LexMap } from '@atproto/lex-data';
import { lexParse } from '@atproto/lex-json';
import { createSpaceSigHeaders, encapsulate, formatMacRequest, parseSpaceToken, RECORD_MAC_PROFILE, verifyRecord } from '@atproto/space';
import { isSpaceAtUriString } from '@atproto/syntax';
import { createJamSpace } from '@plyr/next-core/jam-space';
import { JAM_SPACE, JAM_COORDINATOR_URL, JAM_SERVICE_AUDIENCE, JAM_JOIN_METHOD } from './auth-config.ts';

export type { InitialJam } from '@plyr/next-core/jam-space';

export const { jamSpace, joinJam } = createJamSpace<P256Keypair, LexMap>({ JAM_SPACE, JAM_COORDINATOR_URL, JAM_SERVICE_AUDIENCE, JAM_JOIN_METHOD }, {
  isSpaceAtUriString, createSpaceSigHeaders, encapsulate, formatMacRequest, parseSpaceToken,
  RECORD_MAC_PROFILE, verifyRecord, isCid, isLexMap, lexParse
});
