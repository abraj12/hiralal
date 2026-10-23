/**
 * Core developer options & USB debugging evaluation logic.
 */

function shouldBypassDeveloperModeCheck(isDev, platform) {
  return Boolean(isDev) || platform !== 'android';
}

async function evaluateDeveloperModeStatus({ isDev, platform, nativeModule }) {
  // Constraint 2: Development bypass (__DEV__) and platform isolation
  if (shouldBypassDeveloperModeCheck(isDev, platform)) {
    return false;
  }

  if (!nativeModule || typeof nativeModule.isDeveloperModeEnabled !== 'function') {
    return false;
  }

  try {
    const isEnabled = await nativeModule.isDeveloperModeEnabled();
    return Boolean(isEnabled);
  } catch (error) {
    return false;
  }
}

async function executeOpenDeveloperSettings({ platform, nativeModule }) {
  if (platform !== 'android') {
    return;
  }

  if (!nativeModule || typeof nativeModule.openDeveloperSettings !== 'function') {
    return;
  }

  try {
    await nativeModule.openDeveloperSettings();
  } catch (error) {
    // Fail safe without unhandled rejection
  }
}

module.exports = {
  shouldBypassDeveloperModeCheck,
  evaluateDeveloperModeStatus,
  executeOpenDeveloperSettings,
};
