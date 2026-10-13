#!/usr/bin/env node
/**
 * scripts/test-next-security-floor.cjs
 *
 * Automated regression test suite for Next.js security floor guard (scripts/check-next-security-floor.cjs).
 * Verifies exact boundary conditions, failure closures, advisory mappings, and CLI execution.
 */

const assert = require('assert');
const { spawnSync } = require('child_process');
const path = require('path');
const {
  parseSemver,
  compareSemver,
  evaluateVersion,
  ADVISORY_RULES,
} = require('./check-next-security-floor.cjs');

console.log('===============================================================');
console.log(' Running Next.js Security Floor Guard Regression Tests');
console.log('===============================================================');

let passedTests = 0;

function it(description, fn) {
  try {
    fn();
    console.log(`  ✓ ${description}`);
    passedTests++;
  } catch (err) {
    console.error(`  ✗ ${description}`);
    console.error(`    ${err.message}`);
    process.exit(1);
  }
}

// 1. Semver parsing tests
it('parseSemver parses standard 3-part semver correctly', () => {
  const p = parseSemver('15.5.27');
  assert.strictEqual(p.major, 15);
  assert.strictEqual(p.minor, 5);
  assert.strictEqual(p.patch, 27);
  assert.strictEqual(p.prerelease, null);
});

it('parseSemver handles leading "v" prefix', () => {
  const p = parseSemver('v16.3.0');
  assert.strictEqual(p.major, 16);
  assert.strictEqual(p.minor, 3);
  assert.strictEqual(p.patch, 0);
});

it('parseSemver separates prerelease tag', () => {
  const p = parseSemver('15.5.24-canary.1');
  assert.strictEqual(p.major, 15);
  assert.strictEqual(p.minor, 5);
  assert.strictEqual(p.patch, 24);
  assert.strictEqual(p.prerelease, 'canary.1');
});

it('parseSemver rejects non-string and malformed inputs', () => {
  assert.throws(() => parseSemver(null));
  assert.throws(() => parseSemver(''));
  assert.throws(() => parseSemver('15.5'));
  assert.throws(() => parseSemver('15.5.x'));
  assert.throws(() => parseSemver('not-a-version'));
});

// 2. Semver comparison tests
it('compareSemver accurately compares semver tuples', () => {
  assert.strictEqual(compareSemver('15.5.24', '15.5.24'), 0);
  assert.strictEqual(compareSemver('15.5.25', '15.5.24'), 1);
  assert.strictEqual(compareSemver('15.5.23', '15.5.24'), -1);
  assert.strictEqual(compareSemver('16.0.0', '15.5.24'), 1);
  assert.strictEqual(compareSemver('14.2.0', '15.0.0'), -1);
});

// 3. Exact security floor passing tests
it('Current installed version (15.5.27) passes security floor', () => {
  const res = evaluateVersion('15.5.27');
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.status, 'PASSED');
  assert.strictEqual(res.minPatchedVersion, '15.5.24');
});

it('Exact Next.js 15 floor (15.5.24) passes security floor', () => {
  const res = evaluateVersion('15.5.24');
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.status, 'PASSED');
});

it('Next.js 15.6.0 passes security floor', () => {
  const res = evaluateVersion('15.6.0');
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.status, 'PASSED');
});

it('Exact Next.js 16 floor (16.3.0) passes security floor', () => {
  const res = evaluateVersion('16.3.0');
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.status, 'PASSED');
  assert.strictEqual(res.minPatchedVersion, '16.3.0');
});

it('Next.js 16.3.6 and 16.4.0 pass security floor', () => {
  const res1 = evaluateVersion('16.3.6');
  assert.strictEqual(res1.ok, true);
  const res2 = evaluateVersion('16.4.0');
  assert.strictEqual(res2.ok, true);
});

// 4. Boundary and below-floor rejection tests
it('Next.js 15.5.23 is rejected (one patch below floor 15.5.24)', () => {
  const res = evaluateVersion('15.5.23');
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.status, 'BELOW_SECURITY_FLOOR');
  assert.match(res.reason, /BELOW the required security floor/);
});

it('Next.js 15.4.0 and 15.0.0 are rejected', () => {
  const res1 = evaluateVersion('15.4.0');
  assert.strictEqual(res1.ok, false);
  assert.strictEqual(res1.status, 'BELOW_SECURITY_FLOOR');

  const res2 = evaluateVersion('15.0.0');
  assert.strictEqual(res2.ok, false);
  assert.strictEqual(res2.status, 'BELOW_SECURITY_FLOOR');
});

it('Next.js 16.2.9 is rejected (one patch below floor 16.3.0)', () => {
  const res = evaluateVersion('16.2.9');
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.status, 'BELOW_SECURITY_FLOOR');
  assert.strictEqual(res.minPatchedVersion, '16.3.0');
});

it('Next.js 16.0.0 is rejected', () => {
  const res = evaluateVersion('16.0.0');
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.status, 'BELOW_SECURITY_FLOOR');
});

// 5. Deprecated and vulnerable major versions
it('Next.js 14.x versions are rejected as DEPRECATED_VULNERABLE', () => {
  const res1 = evaluateVersion('14.2.15');
  assert.strictEqual(res1.ok, false);
  assert.strictEqual(res1.status, 'DEPRECATED_VULNERABLE');
  assert.ok(res1.advisories.includes('CVE-2025-29927'));
  assert.ok(res1.advisories.includes('GHSA-2xp9-vwfh-vxw4'));

  const res2 = evaluateVersion('14.0.0');
  assert.strictEqual(res2.ok, false);
  assert.strictEqual(res2.status, 'DEPRECATED_VULNERABLE');
});

it('Ancient versions (e.g. Next 13.x) are rejected as DEPRECATED_VULNERABLE', () => {
  const res = evaluateVersion('13.5.6');
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.status, 'DEPRECATED_VULNERABLE');
});

// 6. Fail-closed tests for future major versions (Next 17+)
it('Future major version (17.0.0) fails closed with UNKNOWN_FUTURE_MAJOR', () => {
  const res = evaluateVersion('17.0.0');
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.status, 'UNKNOWN_FUTURE_MAJOR');
  assert.match(res.reason, /fails closed on major versions >= 17/);
});

it('Future major version (18.1.0) fails closed with UNKNOWN_FUTURE_MAJOR', () => {
  const res = evaluateVersion('18.1.0');
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.status, 'UNKNOWN_FUTURE_MAJOR');
});

// 7. Prerelease tags fail closed
it('Prereleases fail closed (15.5.24-canary.1, 16.3.0-rc.1)', () => {
  const res1 = evaluateVersion('15.5.24-canary.1');
  assert.strictEqual(res1.ok, false);
  assert.strictEqual(res1.status, 'PRERELEASE_FORBIDDEN');

  const res2 = evaluateVersion('16.3.0-rc.1');
  assert.strictEqual(res2.ok, false);
  assert.strictEqual(res2.status, 'PRERELEASE_FORBIDDEN');

  const res3 = evaluateVersion('15.5.27-beta.0');
  assert.strictEqual(res3.ok, false);
  assert.strictEqual(res3.status, 'PRERELEASE_FORBIDDEN');
});

// 8. Malformed version handling
it('Malformed version strings fail safely with INVALID_VERSION', () => {
  const res1 = evaluateVersion('invalid-semver');
  assert.strictEqual(res1.ok, false);
  assert.strictEqual(res1.status, 'INVALID_VERSION');

  const res2 = evaluateVersion('');
  assert.strictEqual(res2.ok, false);
  assert.strictEqual(res2.status, 'INVALID_VERSION');
});

// 9. CLI end-to-end execution
it('CLI execution exits 0 against installed repo dependencies', () => {
  const scriptPath = path.join(__dirname, 'check-next-security-floor.cjs');
  const proc = spawnSync(process.execPath, [scriptPath], {
    encoding: 'utf8',
  });
  assert.strictEqual(proc.status, 0, `CLI failed with output: ${proc.stderr || proc.stdout}`);
  assert.match(proc.stdout, /Next.js Security Advisory Floor Guard/);
  assert.match(proc.stdout, /PASSED/);
});

console.log('===============================================================');
console.log(` All ${passedTests} Next.js Security Floor Regression Tests PASSED!`);
console.log('===============================================================');
