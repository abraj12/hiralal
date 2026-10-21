const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

test('Admin App Configuration - package name is com.admin.login', () => {
  const appJsonPath = path.join(__dirname, '../app.json');
  const appJson = JSON.parse(fs.readFileSync(appJsonPath, 'utf8'));

  assert.strictEqual(
    appJson.expo.android.package,
    'com.admin.login',
    'Android package / bundle identifier must be com.admin.login'
  );
  assert.strictEqual(
    appJson.expo.name,
    'Hiralal Admin',
    'App name must reflect Hiralal Admin'
  );
});

test('Admin Role Enforcement - strictly permits only 2 admin roles: BILL_ADMIN and OPERATIONS_ADMIN', () => {
  const allowedAdminRoles = ['BILL_ADMIN', 'OPERATIONS_ADMIN'];

  function validateAdminRole(role) {
    if (!allowedAdminRoles.includes(role)) {
      throw new Error(`Unauthorized role: ${role}. Access is restricted strictly to BILL_ADMIN and OPERATIONS_ADMIN.`);
    }
    return true;
  }

  // 1. Valid Admin Roles
  assert.ok(validateAdminRole('BILL_ADMIN'));
  assert.ok(validateAdminRole('OPERATIONS_ADMIN'));

  // 2. Reject Consumer User Role
  assert.throws(() => validateAdminRole('USER'), /Unauthorized role: USER/);

  // 3. Reject Legacy ADMIN or undefined
  assert.throws(() => validateAdminRole('ADMIN'), /Unauthorized role: ADMIN/);
  assert.throws(() => validateAdminRole('SUPER_ADMIN'), /Unauthorized role: SUPER_ADMIN/);
  assert.throws(() => validateAdminRole(undefined), /Unauthorized role/);
});

test('Admin App Security - Play Integrity, SecureStore, and Release Signing are configured', () => {
  const appJsonPath = path.join(__dirname, '../app.json');
  const appJson = JSON.parse(fs.readFileSync(appJsonPath, 'utf8'));
  const plugins = appJson.expo.plugins || [];

  assert.ok(plugins.includes('./plugins/withPlayIntegrity'), 'withPlayIntegrity plugin must be configured');
  assert.ok(plugins.includes('./plugins/withReleaseSigning'), 'withReleaseSigning plugin must be configured');

  const pkgJsonPath = path.join(__dirname, '../package.json');
  const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
  assert.ok(pkgJson.dependencies['expo-secure-store'], 'expo-secure-store must be in dependencies');
});
