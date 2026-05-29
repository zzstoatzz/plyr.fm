import { AtpAgent } from '@atproto/api';

/**
 * Whether the given DID has published an atprotofans profile that is accepting
 * supporters. `com.atprotofans.profile` isn't indexed by the Bluesky appview,
 * so we resolve the DID to its PDS and read the record directly.
 */
export async function checkAtprotofansEligibility(did: string | undefined): Promise<boolean> {
	if (!did) return false;
	try {
		const didDoc = await fetch(`https://plc.directory/${did}`).then((r) => r.json());
		const pdsService = didDoc?.service?.find((s: { id: string }) => s.id === '#atproto_pds');
		const pdsUrl = pdsService?.serviceEndpoint;
		if (!pdsUrl) return false;

		const agent = new AtpAgent({ service: pdsUrl });
		const response = await agent.com.atproto.repo.getRecord({
			repo: did,
			collection: 'com.atprotofans.profile',
			rkey: 'self'
		});
		const value = response.data.value as { acceptingSupporters?: boolean } | undefined;
		return value?.acceptingSupporters === true;
	} catch {
		// record doesn't exist or other error — not eligible
		return false;
	}
}
