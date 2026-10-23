const test = require('node:test');
const assert = require('node:assert/strict');
const {
  shouldBypassDeveloperModeCheck,
  evaluateDeveloperModeStatus,
  executeOpenDeveloperSettings,
} = require('./developerSecurity');

test('developerSecurity: shouldBypassDeveloperModeCheck - returns true when isDev is true', () => {
  assert.equal(shouldBypassDeveloperModeCheck(true, 'android'), true);
  assert.equal(shouldBypassDeveloperModeCheck(true, 'ios'), true);
});

test('developerSecurity: shouldBypassDeveloperModeCheck - returns true for non-Android platforms', () => {
  assert.equal(shouldBypassDeveloperModeCheck(false, 'ios'), true);
  assert.equal(shouldBypassDeveloperModeCheck(false, 'web'), true);
});

test('developerSecurity: shouldBypassDeveloperModeCheck - returns false only for Android in production', () => {
  assert.equal(shouldBypassDeveloperModeCheck(false, 'android'), false);
});

test('developerSecurity: evaluateDeveloperModeStatus - returns false when isDev is true (Development Bypass)', async () => {
  let nativeCalled = false;
  const mockModule = {
    isDeveloperModeEnabled: async () => {
      nativeCalled = true;
      return true; // Even if device has dev options on, isDev must bypass!
    },
    openDeveloperSettings: async () => true,
  };

  const result = await evaluateDeveloperModeStatus({
    isDev: true,
    platform: 'android',
    nativeModule: mockModule,
  });

  assert.equal(result, false);
  assert.equal(nativeCalled, false, 'Native method must NOT be called when isDev is true');
});

test('developerSecurity: evaluateDeveloperModeStatus - returns false on non-Android platforms', async () => {
  let nativeCalled = false;
  const mockModule = {
    isDeveloperModeEnabled: async () => {
      nativeCalled = true;
      return true;
    },
    openDeveloperSettings: async () => true,
  };

  const resultIos = await evaluateDeveloperModeStatus({
    isDev: false,
    platform: 'ios',
    nativeModule: mockModule,
  });
  assert.equal(resultIos, false);
  assert.equal(nativeCalled, false);

  const resultWeb = await evaluateDeveloperModeStatus({
    isDev: false,
    platform: 'web',
    nativeModule: mockModule,
  });
  assert.equal(resultWeb, false);
  assert.equal(nativeCalled, false);
});

test('developerSecurity: evaluateDeveloperModeStatus - queries native method and returns true when active in production Android', async () => {
  const mockModule = {
    isDeveloperModeEnabled: async () => true,
    openDeveloperSettings: async () => true,
  };

  const result = await evaluateDeveloperModeStatus({
    isDev: false,
    platform: 'android',
    nativeModule: mockModule,
  });

  assert.equal(result, true);
});

test('developerSecurity: evaluateDeveloperModeStatus - returns false when developer options are disabled in production Android', async () => {
  const mockModule = {
    isDeveloperModeEnabled: async () => false,
    openDeveloperSettings: async () => true,
  };

  const result = await evaluateDeveloperModeStatus({
    isDev: false,
    platform: 'android',
    nativeModule: mockModule,
  });

  assert.equal(result, false);
});

test('developerSecurity: evaluateDeveloperModeStatus - handles missing native module gracefully without crashing', async () => {
  const result = await evaluateDeveloperModeStatus({
    isDev: false,
    platform: 'android',
    nativeModule: null,
  });

  assert.equal(result, false);
});

test('developerSecurity: evaluateDeveloperModeStatus - handles native exception safely without throwing', async () => {
  const mockModule = {
    isDeveloperModeEnabled: async () => {
      throw new Error('IPC IPC_BINDER_FAILURE');
    },
    openDeveloperSettings: async () => true,
  };

  const result = await evaluateDeveloperModeStatus({
    isDev: false,
    platform: 'android',
    nativeModule: mockModule,
  });

  assert.equal(result, false);
});

test('developerSecurity: executeOpenDeveloperSettings - triggers native intent in production Android', async () => {
  let settingsOpened = false;
  const mockModule = {
    isDeveloperModeEnabled: async () => true,
    openDeveloperSettings: async () => {
      settingsOpened = true;
      return true;
    },
  };

  await executeOpenDeveloperSettings({
    platform: 'android',
    nativeModule: mockModule,
  });

  assert.equal(settingsOpened, true);
});

test('developerSecurity: executeOpenDeveloperSettings - ignores non-Android platforms', async () => {
  let settingsOpened = false;
  const mockModule = {
    openDeveloperSettings: async () => {
      settingsOpened = true;
      return true;
    },
  };

  await executeOpenDeveloperSettings({
    platform: 'ios',
    nativeModule: mockModule,
  });

  assert.equal(settingsOpened, false);
});
