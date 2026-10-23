const test = require('node:test');
const assert = require('node:assert/strict');
const {
  insertImportAfterPackageDeclaration,
  registerSecurityPackage,
} = require('./withDeveloperModeSecurity');

test('withDeveloperModeSecurity: insertImportAfterPackageDeclaration - Kotlin: inserts import after package declaration', () => {
  const kotlinSource = `package com.hiralal.rewards

import android.app.Application
import com.facebook.react.PackageList

class MainApplication : Application()
`;

  const updated = insertImportAfterPackageDeclaration(
    kotlinSource,
    'com.hiralal.rewards.security.SecurityPackage',
    true
  );

  const lines = updated.split('\n');
  assert.equal(lines[0].trim(), 'package com.hiralal.rewards');
  assert.equal(lines[1].trim(), 'import com.hiralal.rewards.security.SecurityPackage');
  assert.ok(updated.includes('import android.app.Application'));
});

test('withDeveloperModeSecurity: insertImportAfterPackageDeclaration - Java: inserts import after package declaration with semicolon', () => {
  const javaSource = `package com.hiralal.rewards;

import android.app.Application;
import com.facebook.react.PackageList;

public class MainApplication extends Application {
}
`;

  const updated = insertImportAfterPackageDeclaration(
    javaSource,
    'com.hiralal.rewards.security.SecurityPackage',
    false
  );

  const lines = updated.split('\n');
  assert.equal(lines[0].trim(), 'package com.hiralal.rewards;');
  assert.equal(lines[1].trim(), 'import com.hiralal.rewards.security.SecurityPackage;');
  assert.ok(updated.includes('import android.app.Application;'));
});

test('withDeveloperModeSecurity: insertImportAfterPackageDeclaration - Idempotency: repeated calls do not duplicate import', () => {
  const kotlinSource = `package com.hiralal.rewards

import android.app.Application

class MainApplication : Application()
`;

  const once = insertImportAfterPackageDeclaration(
    kotlinSource,
    'com.hiralal.rewards.security.SecurityPackage',
    true
  );

  const twice = insertImportAfterPackageDeclaration(
    once,
    'com.hiralal.rewards.security.SecurityPackage',
    true
  );

  const matches = twice.match(/import com\.hiralal\.rewards\.security\.SecurityPackage/g);
  assert.equal(matches?.length, 1);
});

test('withDeveloperModeSecurity: registerSecurityPackage - Kotlin: registers into PackageList(this).packages.apply', () => {
  const kotlinSource = `
    override val reactHost: ReactHost by lazy {
      ExpoReactHostFactory.getDefaultReactHost(
        context = applicationContext,
        packageList =
          PackageList(this).packages.apply {
            add(PlayIntegrityPackage())
          }
      )
    }
  `;

  const updated = registerSecurityPackage(kotlinSource, true);
  assert.ok(updated.includes('add(SecurityPackage())'));
  assert.ok(updated.includes('add(PlayIntegrityPackage())'));
});

test('withDeveloperModeSecurity: registerSecurityPackage - Kotlin: idempotency does not duplicate registration', () => {
  const kotlinSource = `
    PackageList(this).packages.apply {
      add(SecurityPackage())
    }
  `;

  const updated = registerSecurityPackage(kotlinSource, true);
  const matches = updated.match(/add\(SecurityPackage\(\)\)/g);
  assert.equal(matches?.length, 1);
});

test('withDeveloperModeSecurity: registerSecurityPackage - Java: registers package into new PackageList(this).getPackages()', () => {
  const javaSource = `
    @Override
    protected List<ReactPackage> getPackages() {
      List<ReactPackage> packages = new PackageList(this).getPackages();
      return packages;
    }
  `;

  const updated = registerSecurityPackage(javaSource, false);
  assert.ok(updated.includes('packages.add(new SecurityPackage());'));
});

test('withDeveloperModeSecurity: registerSecurityPackage - Throws error when package declaration is missing', () => {
  assert.throws(() => {
    insertImportAfterPackageDeclaration('class MissingPackageDeclaration {}', 'com.test.Pkg', true);
  }, /MainApplication has no recognizable package declaration/);
});
