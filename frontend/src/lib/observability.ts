import { getWebAutoInstrumentations } from '@opentelemetry/auto-instrumentations-web';
import logfire from '@pydantic/logfire-browser';
import { API_URL } from '$lib/config';

function deriveEnvironment(): string {
	if (API_URL.includes('localhost')) return 'local';
	if (API_URL.includes('api-stg')) return 'staging';
	return 'production';
}

export function initObservability(): void {
	logfire.configure({
		traceUrl: `${API_URL}/logfire-proxy/v1/traces`,
		serviceName: 'plyr-web',
		environment: deriveEnvironment(),
		instrumentations: [
			getWebAutoInstrumentations({
				'@opentelemetry/instrumentation-fetch': {
					propagateTraceHeaderCorsUrls: [new RegExp(API_URL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))]
				},
				'@opentelemetry/instrumentation-xml-http-request': {
					propagateTraceHeaderCorsUrls: [new RegExp(API_URL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))]
				}
			})
		]
	});
}

/**
 * Record a rejected `audio.play()` call so we can see, in production,
 * whether the locked-screen auto-advance fast path actually dodges the
 * autoplay block — and which browsers still reject anyway.
 *
 * Logfire's auto-instrumentation only captures fetches/XHR; manual
 * spans for non-network events go through `logfire.info`. We send
 * structured attributes so the analysis query can group by `errorName`,
 * `fastPath`, `preloaded`, and `visibilityState` to compare paths.
 */
export interface PlaybackRejectionContext {
	errorName: string;
	errorMessage: string;
	visibilityState: DocumentVisibilityState;
	audioReadyState: number;
	/** True when handleTrackEnded used the synchronous swap path. */
	fastPath: boolean;
	/** Outcome of the next-track preloader at the moment ended fired. */
	preloaded: 'ready' | 'gated-denied' | 'failed' | 'absent';
	/** What initiated the play call. */
	reason: 'auto-advance' | 'user';
}

export function recordPlaybackRejection(ctx: PlaybackRejectionContext): void {
	try {
		logfire.info('audio play() rejected', {
			'error.name': ctx.errorName,
			'error.message': ctx.errorMessage,
			'document.visibility_state': ctx.visibilityState,
			'audio.ready_state': ctx.audioReadyState,
			'playback.fast_path': ctx.fastPath,
			'playback.preloaded': ctx.preloaded,
			'playback.reason': ctx.reason
		});
	} catch {
		// observability must never break playback recovery
	}
}
