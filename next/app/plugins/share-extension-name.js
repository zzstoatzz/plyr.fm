const fs = require('fs');
const path = require('path');
const { withFinalizedMod } = require('expo/config-plugins');

// expo-sharing names its share extension after the target; the share sheet should say plyr.fm.
module.exports = (config) => withFinalizedMod(config, ['ios', (config) => {
  const plist = path.join(config.modRequest.platformProjectRoot, 'expo-sharing-extension', 'Info.plist');
  if (fs.existsSync(plist)) {
    const xml = fs.readFileSync(plist, 'utf8');
    fs.writeFileSync(plist, xml.replace(/(<key>CFBundleDisplayName<\/key>\s*<string>)[^<]*(<\/string>)/, `$1${config.name}$2`));
  }
  return config;
}]);
