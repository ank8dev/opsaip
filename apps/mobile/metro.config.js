// The phone app reads the web app's typed sample data and pure selectors
// (apps/web/src/types.ts, mocks/, data/selectors.ts) so both show the same team.
// apps/mobile is its own npm project (React Native pins its own React), so Metro
// is told to watch that folder explicitly.
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
config.watchFolders = [...(config.watchFolders ?? []), path.resolve(__dirname, '../web/src')];

module.exports = config;
