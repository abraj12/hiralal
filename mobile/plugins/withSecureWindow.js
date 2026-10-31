const { withMainActivity, createRunOncePlugin } = require('expo/config-plugins');

/**
 * HIR-I-03: The admin app displays PAN-verified names, mobile numbers, bank details and invoice
 * images. FLAG_SECURE stops screenshots, screen recording and recent-apps thumbnails from
 * capturing that data.
 */
const KOTLIN_FLAG =
  'window.setFlags(android.view.WindowManager.LayoutParams.FLAG_SECURE, android.view.WindowManager.LayoutParams.FLAG_SECURE)';
const JAVA_FLAG =
  'getWindow().setFlags(android.view.WindowManager.LayoutParams.FLAG_SECURE, android.view.WindowManager.LayoutParams.FLAG_SECURE);';

function addSecureFlag(contents, isKotlin) {
  const flagLine = isKotlin ? KOTLIN_FLAG : JAVA_FLAG;
  if (contents.includes('LayoutParams.FLAG_SECURE')) {
    return contents;
  }

  const superOnCreate = isKotlin
    ? /([ \t]*)super\.onCreate\([^)]*\)[ \t]*;?[ \t]*\r?\n/
    : /([ \t]*)super\.onCreate\([^)]*\);[ \t]*\r?\n/;
  const match = contents.match(superOnCreate);
  if (!match || match.index === undefined) {
    throw new Error('Cannot apply FLAG_SECURE: MainActivity has no recognizable super.onCreate call.');
  }

  const insertAt = match.index + match[0].length;
  return contents.slice(0, insertAt) + `${match[1]}${flagLine}\n` + contents.slice(insertAt);
}

function withSecureWindow(config) {
  return withMainActivity(config, (modConfig) => {
    const isKotlin = modConfig.modResults.language === 'kt';
    modConfig.modResults.contents = addSecureFlag(modConfig.modResults.contents, isKotlin);
    return modConfig;
  });
}

const plugin = createRunOncePlugin(withSecureWindow, 'withSecureWindow', '1.0.0');
plugin.addSecureFlag = addSecureFlag;

module.exports = plugin;
