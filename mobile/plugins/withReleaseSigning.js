const { withAppBuildGradle, createRunOncePlugin } = require('expo/config-plugins');

/**
 * Expo Config Plugin to inject reproducible Android release signing configuration into app/build.gradle.
 * Survives `expo prebuild --clean` without manual native project edits.
 * Falls back safely to debug keystore when release credentials are not provided (e.g. dev/CI).
 */
function configureAppBuildGradle(contents) {
  if (contents.includes('[SECURITY FATAL] Android release build requires a valid release keystore')) {
    return contents;
  }

  const releaseSigningConfig = `        release {
            if (project.hasProperty('RELEASE_STORE_FILE')) {
                storeFile file(RELEASE_STORE_FILE)
                storePassword RELEASE_STORE_PASSWORD
                keyAlias RELEASE_KEY_ALIAS
                keyPassword RELEASE_KEY_PASSWORD
            } else if (System.getenv('ANDROID_KEYSTORE_PATH')) {
                storeFile file(System.getenv('ANDROID_KEYSTORE_PATH'))
                storePassword System.getenv('ANDROID_KEYSTORE_PASSWORD')
                keyAlias System.getenv('ANDROID_KEY_ALIAS')
                keyPassword System.getenv('ANDROID_KEY_PASSWORD')
            }
        }`;

  // Insert release block inside signingConfigs
  if (contents.includes('signingConfigs {')) {
    contents = contents.replace(
      'signingConfigs {',
      `signingConfigs {\n${releaseSigningConfig}`
    );
  }

  // Update buildTypes release signingConfig to use release when available
  const buildTypesIdx = contents.indexOf('buildTypes {');
  if (buildTypesIdx !== -1) {
    const releaseIdx = contents.indexOf('release {', buildTypesIdx);
    if (releaseIdx !== -1) {
      const targetStr = 'signingConfig signingConfigs.debug';
      const targetIdx = contents.indexOf(targetStr, releaseIdx);
      if (targetIdx !== -1) {
        const replacement = `signingConfig ((project.hasProperty('RELEASE_STORE_FILE') || System.getenv('ANDROID_KEYSTORE_PATH')) ? signingConfigs.release : (gradle.startParameter.taskNames.any { it.toLowerCase().contains('release') } && !project.hasProperty('ALLOW_INSECURE_DEBUG_SIGNING') ? { throw new GradleException("[SECURITY FATAL] Android release build requires a valid release keystore via RELEASE_STORE_FILE or ANDROID_KEYSTORE_PATH. Debug signing fallback in release mode is forbidden.") }() : signingConfigs.debug))`;
        contents = contents.substring(0, targetIdx) + replacement + contents.substring(targetIdx + targetStr.length);
      }
    }
  }

  return contents;
}

function withReleaseSigning(config) {
  return withAppBuildGradle(config, (gradleConfig) => {
    gradleConfig.modResults.contents = configureAppBuildGradle(gradleConfig.modResults.contents);
    return gradleConfig;
  });
}

module.exports = createRunOncePlugin(withReleaseSigning, 'withReleaseSigning', '1.0.0');
module.exports.configureAppBuildGradle = configureAppBuildGradle;
