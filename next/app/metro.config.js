const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
config.resolver.resolveRequest = (context, name, platform) => {
	// The Expo OAuth package imports .js while publishing platform-suffixed files.
	const upstreamEntry = context.originModulePath.endsWith('/@atproto/oauth-client-expo/dist/index.js');
	const target = upstreamEntry && name === './expo-oauth-client.js' ? './expo-oauth-client' : name;
	return context.resolveRequest(context, target, platform);
};
module.exports = config;
