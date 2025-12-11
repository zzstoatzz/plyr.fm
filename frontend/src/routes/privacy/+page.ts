import { getServerConfig } from '$lib/config';

export async function load() {
	const config = await getServerConfig();
	return {
		contactEmail: config.contact_email,
		privacyEmail: config.privacy_email,
		dmcaEmail: config.dmca_email,
		dmcaRegistrationNumber: config.dmca_registration_number
	};
}
