import type { P256Keypair } from '@atproto/crypto';
import { isCid, isLexMap, type LexMap } from '@atproto/lex-data';
import { lexParse } from '@atproto/lex-json';
import { createSpaceSigHeaders, encapsulate, formatMacRequest, parseSpaceToken, RECORD_MAC_PROFILE, verifyRecord } from '@atproto/space';
import { isSpaceAtUriString } from '@atproto/syntax';
import { createJamSpace } from '@plyr/next-core/jam-space';
import { authConfig } from './auth-config';

export const { jamSpace, joinJam } = createJamSpace<P256Keypair, LexMap>(authConfig, {
  isSpaceAtUriString, createSpaceSigHeaders, encapsulate, formatMacRequest, parseSpaceToken,
  RECORD_MAC_PROFILE, verifyRecord, isCid, isLexMap, lexParse
});
