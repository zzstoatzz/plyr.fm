const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");

const repoRoot = path.resolve(__dirname, "..");
const config = getDefaultConfig(__dirname);

// shared/ lives beside the web app one level up.
config.watchFolders = [repoRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(__dirname, "node_modules"),
  path.resolve(repoRoot, "node_modules"),
];

module.exports = config;
