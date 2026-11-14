import type { P256Keypair } from '@atproto/crypto';
import { isCid, isLexMap, type LexMap } from '@atproto/lex-data';
import { lexParse } from '@atproto/lex-json';
import { createSpaceSigHeaders, encapsulate, formatMacRequest, parseSpaceToken, RECORD_MAC_PROFILE, verifyRecord } from '@atproto/space';
import { isSpaceAtUriString } from '@atproto/syntax';
import { createGatedAudio, type SpaceAudioTransport as Transport } from '../../core/src/gated-audio.ts';

export type { GatedAudioSource } from '../../core/src/gated-audio.ts';
export type SpaceAudioTransport = Transport<P256Keypair>;

export const { credentialFor, signedFetch, resolveGatedAudio, openGatedAudio } = createGatedAudio<P256Keypair, LexMap>({
	isSpaceAtUriString, createSpaceSigHeaders, encapsulate, formatMacRequest, parseSpaceToken,
	RECORD_MAC_PROFILE, verifyRecord, isCid, isLexMap, lexParse
});
