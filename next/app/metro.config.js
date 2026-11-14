const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
config.watchFolders.push(path.resolve(__dirname, '../core'), path.resolve(__dirname, '../web/src/lib/media'), path.resolve(__dirname, '../web/src/lib/storage'));
config.resolver.resolveRequest = (context, name, platform) => {
	// The Expo OAuth package imports .js while publishing platform-suffixed files.
	const upstreamEntry = context.originModulePath.endsWith('/@atproto/oauth-client-expo/dist/index.js');
	const target = upstreamEntry && name === './expo-oauth-client.js' ? './expo-oauth-client' : name;
	return context.resolveRequest(context, target, platform);
};
module.exports = config;
