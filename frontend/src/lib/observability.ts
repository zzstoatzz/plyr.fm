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
