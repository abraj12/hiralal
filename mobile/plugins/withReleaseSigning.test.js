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
  assert.ok(result.includes("signingConfigs.release : signingConfigs.debug"));
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
