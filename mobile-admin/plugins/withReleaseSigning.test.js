const test = require('node:test');
const assert = require('node:assert/strict');
const { configureAppBuildGradle } = require('./withReleaseSigning');

test('withReleaseSigning - injects release signingConfig into signingConfigs block', () => {
  const sampleGradle = `
android {
    signingConfigs {
        debug {
            storeFile file('debug.keystore')
        }
    }
    buildTypes {
        release {
            signingConfig signingConfigs.debug
        }
    }
}
`;

  const result = configureAppBuildGradle(sampleGradle);
  assert.ok(result.includes("System.getenv('ANDROID_KEYSTORE_PATH')"));
  assert.ok(result.includes("storePassword System.getenv('ANDROID_KEYSTORE_PASSWORD')"));
  assert.ok(result.includes("signingConfigs.release : (gradle.startParameter.taskNames.any { it.toLowerCase().contains('release') }"));
});

test('withReleaseSigning - correctly targets buildTypes.release and leaves buildTypes.debug untouched', () => {
  const sampleGradle = `
android {
    signingConfigs {
        debug {
            storeFile file('debug.keystore')
        }
    }
    buildTypes {
        debug {
            signingConfig signingConfigs.debug
        }
        release {
            signingConfig signingConfigs.debug
        }
    }
}
`;

  const result = configureAppBuildGradle(sampleGradle);
  assert.ok(result.includes(`        debug {
            signingConfig signingConfigs.debug
        }`));
  assert.ok(result.includes(`        release {
            signingConfig ((project.hasProperty('RELEASE_STORE_FILE') || System.getenv('ANDROID_KEYSTORE_PATH')) ? signingConfigs.release : (gradle.startParameter.taskNames.any { it.toLowerCase().contains('release') } && !project.hasProperty('ALLOW_INSECURE_DEBUG_SIGNING') ? { throw new GradleException("[SECURITY FATAL] Android release build requires a valid release keystore via RELEASE_STORE_FILE or ANDROID_KEYSTORE_PATH. Debug signing fallback in release mode is forbidden.") }() : signingConfigs.debug))`));
});

test('withReleaseSigning - idempotent on repeated executions', () => {
  const sampleGradle = `
android {
    signingConfigs {
        debug {
            storeFile file('debug.keystore')
        }
    }
    buildTypes {
        debug {
            signingConfig signingConfigs.debug
        }
        release {
            signingConfig signingConfigs.debug
        }
    }
}
`;

  const firstPass = configureAppBuildGradle(sampleGradle);
  const secondPass = configureAppBuildGradle(firstPass);
  assert.equal(firstPass, secondPass);
});
