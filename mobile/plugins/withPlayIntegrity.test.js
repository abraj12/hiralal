const test = require('node:test');
const assert = require('node:assert/strict');
const {
  insertImportAfterPackageDeclaration,
  registerPlayIntegrityPackage,
} = require('./withPlayIntegrity');

test('insertImportAfterPackageDeclaration - Kotlin: inserts import after package declaration without semicolon', () => {
  const kotlinSource = `package com.hiralal.rewards

import android.app.Application
import com.facebook.react.PackageList

class MainApplication : Application()
`;

  const updated = insertImportAfterPackageDeclaration(
    kotlinSource,
    'com.hiralal.rewards.integrity.PlayIntegrityPackage',
    true
  );

  const lines = updated.split('\n');
  assert.equal(lines[0].trim(), 'package com.hiralal.rewards');
  assert.equal(lines[1].trim(), 'import com.hiralal.rewards.integrity.PlayIntegrityPackage');
  assert.ok(updated.includes('import android.app.Application'));
});

test('insertImportAfterPackageDeclaration - Java: inserts import after package declaration with semicolon', () => {
  const javaSource = `package com.hiralal.rewards;

import android.app.Application;
import com.facebook.react.PackageList;

public class MainApplication extends Application {
}
`;

  const updated = insertImportAfterPackageDeclaration(
    javaSource,
    'com.hiralal.rewards.integrity.PlayIntegrityPackage',
    false
  );

  const lines = updated.split('\n');
  assert.equal(lines[0].trim(), 'package com.hiralal.rewards;');
  assert.equal(lines[1].trim(), 'import com.hiralal.rewards.integrity.PlayIntegrityPackage;');
  assert.ok(updated.includes('import android.app.Application;'));
});

test('insertImportAfterPackageDeclaration - Idempotency: repeated calls do not duplicate import', () => {
  const kotlinSource = `package com.hiralal.rewards

import android.app.Application

class MainApplication : Application()
`;

  const once = insertImportAfterPackageDeclaration(
    kotlinSource,
    'com.hiralal.rewards.integrity.PlayIntegrityPackage',
    true
  );

  const twice = insertImportAfterPackageDeclaration(
    once,
    'com.hiralal.rewards.integrity.PlayIntegrityPackage',
    true
  );

  assert.equal(once, twice);
  const occurrences = (twice.match(/import com\.hiralal\.rewards\.integrity\.PlayIntegrityPackage/g) || []).length;
  assert.equal(occurrences, 1);
});

test('insertImportAfterPackageDeclaration - Throws error when package declaration is missing', () => {
  const invalidSource = `import android.app.Application

class MainApplication : Application()
`;

  assert.throws(
    () => {
      insertImportAfterPackageDeclaration(
        invalidSource,
        'com.hiralal.rewards.integrity.PlayIntegrityPackage',
        true
      );
    },
    /Cannot register Play Integrity: MainApplication has no recognizable package declaration/
  );
});

test('registerPlayIntegrityPackage - Kotlin: registers package into PackageList(this).packages.apply', () => {
  const kotlinSource = `override fun getPackages(): List<ReactPackage> =
    PackageList(this).packages.apply {
      // Packages
    }
`;

  const updated = registerPlayIntegrityPackage(kotlinSource, true);
  assert.ok(updated.includes('add(PlayIntegrityPackage())'));
  assert.ok(updated.includes('PackageList(this).packages.apply {'));
});

test('registerPlayIntegrityPackage - Kotlin: registers package into PackageList(this).packages when apply is omitted', () => {
  const kotlinSource = `override fun getPackages(): List<ReactPackage> =
    PackageList(this).packages
`;

  const updated = registerPlayIntegrityPackage(kotlinSource, true);
  assert.ok(updated.includes('add(PlayIntegrityPackage())'));
});

test('registerPlayIntegrityPackage - Java: registers package into new PackageList(this).getPackages()', () => {
  const javaSource = `List<ReactPackage> packages = new PackageList(this).getPackages();
return packages;
`;

  const updated = registerPlayIntegrityPackage(javaSource, false);
  assert.ok(updated.includes('packages.add(new PlayIntegrityPackage());'));
});

test('registerPlayIntegrityPackage - Idempotency: does not duplicate registration', () => {
  const kotlinSource = `PackageList(this).packages.apply {
  add(PlayIntegrityPackage())
}
`;

  const updated = registerPlayIntegrityPackage(kotlinSource, true);
  assert.equal(updated, kotlinSource);
});

test('registerPlayIntegrityPackage - Throws error when Kotlin structure is unrecognized', () => {
  const unrecognized = `class MainApplication { /* empty */ }`;
  assert.throws(
    () => registerPlayIntegrityPackage(unrecognized, true),
    /MainApplication\.kt does not match any recognized Kotlin package registration pattern/
  );
});

test('registerPlayIntegrityPackage - Throws error when Java structure is unrecognized', () => {
  const unrecognized = `public class MainApplication { /* empty */ }`;
  assert.throws(
    () => registerPlayIntegrityPackage(unrecognized, false),
    /MainApplication\.java does not match any recognized Java package registration pattern/
  );
});
