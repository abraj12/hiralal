#!/usr/bin/env node
/**
 * scripts/check-next-security-floor.cjs
 *
 * Automated semantic-version security floor verification guard for Next.js.
 * Verifies that the resolved Next.js version in admin satisfies official security advisory floors.
 *
 * Advisories evaluated (as of October 2026 audit):
 * - GHSA-2xp9-vwfh-vxw4 (Critical AVIF / image optimization & Windows hosting memory corruption)
 * - GHSA-p293-qw3h-jr36 (Server Actions boundary & cache header spoofing)
 * - GHSA-p9j2-gv94-2wf4 (next/og remote code execution / buffer overflow)
 * - GHSA-vcvr-r3jv-pc5j (Middleware URL rewrite authorization bypass)
 * - CVE-2025-29927 (Middleware / router authorization cache poisoning)
 *
 * Minimum Patched Floors:
 * - 14.x: Unmaintained / vulnerable. All 14.x versions rejected.
 * - 15.x: >= 15.5.24 required.
 * - 16.x: >= 16.3.6 required.
 *
 * Maintenance / update procedure:
 * When new upstream Next.js advisories are published, update the ADVISORY_RULES table below
 * with the new minimum patched floor and advisory identifiers.
 */

const fs = require('fs');
const path = require('path');

function parseSemver(v) {
  if (!v || typeof v !== 'string') {
    throw new Error(`Invalid version input: ${v}`);
  }
  const clean = v.trim().replace(/^v/, '');
  const [main, prerelease] = clean.split('-');
  const parts = main.split('.').map((p) => parseInt(p, 10));
  if (parts.length !== 3 || parts.some(isNaN)) {
    throw new Error(`Invalid semver format: "${v}"`);
  }
  return {
    major: parts[0],
    minor: parts[1],
    patch: parts[2],
    prerelease: prerelease || null,
    raw: v,
  };
}

function compareSemver(a, b) {
  const vA = typeof a === 'string' ? parseSemver(a) : a;
  const vB = typeof b === 'string' ? parseSemver(b) : b;

  if (vA.major !== vB.major) return vA.major > vB.major ? 1 : -1;
  if (vA.minor !== vB.minor) return vA.minor > vB.minor ? 1 : -1;
  if (vA.patch !== vB.patch) return vA.patch > vB.patch ? 1 : -1;

  if (!vA.prerelease && vB.prerelease) return 1;
  if (vA.prerelease && !vB.prerelease) return -1;
  if (vA.prerelease && vB.prerelease) {
    if (vA.prerelease === vB.prerelease) return 0;
    return vA.prerelease > vB.prerelease ? 1 : -1;
  }
  return 0;
}

const ADVISORY_RULES = {
  14: {
    status: 'DEPRECATED_VULNERABLE',
    minPatchedVersion: null,
    reason: 'Next.js 14.x line is affected by unpatched advisories (CVE-2025-29927, GHSA-2xp9-vwfh-vxw4, GHSA-p293-qw3h-jr36). Must upgrade to maintained 15.x patched line.',
    advisories: ['CVE-2025-29927', 'GHSA-2xp9-vwfh-vxw4', 'GHSA-p293-qw3h-jr36', 'GHSA-p9j2-gv94-2wf4', 'GHSA-vcvr-r3jv-pc5j'],
  },
  15: {
    status: 'MAINTAINED',
    minPatchedVersion: '15.5.24',
    reason: 'Versions below 15.5.24 are affected by GHSA-2xp9-vwfh-vxw4 (critical image-optimization and Windows-hosted advisories).',
    advisories: ['GHSA-2xp9-vwfh-vxw4', 'GHSA-p293-qw3h-jr36', 'GHSA-p9j2-gv94-2wf4', 'GHSA-vcvr-r3jv-pc5j'],
  },
  16: {
    status: 'MAINTAINED',
    minPatchedVersion: '16.3.6',
    reason: 'Versions below 16.3.6 are affected by GHSA-p9j2-gv94-2wf4 (next/og critical advisory).',
    advisories: ['GHSA-p9j2-gv94-2wf4'],
  },
};

function findNextPackageJson() {
  const candidatePaths = [
    path.join(process.cwd(), 'node_modules', 'next', 'package.json'),
    path.join(process.cwd(), 'admin', 'node_modules', 'next', 'package.json'),
    path.join(__dirname, '..', 'admin', 'node_modules', 'next', 'package.json'),
    path.join(__dirname, '..', 'node_modules', 'next', 'package.json'),
  ];

  for (const p of candidatePaths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }

  // Fallback: check admin package.json declared version if node_modules not yet installed
  const adminPkg = [
    path.join(process.cwd(), 'package.json'),
    path.join(process.cwd(), 'admin', 'package.json'),
    path.join(__dirname, '..', 'admin', 'package.json'),
  ].find(fs.existsSync);

  if (adminPkg) {
    const data = JSON.parse(fs.readFileSync(adminPkg, 'utf8'));
    if (data.dependencies && data.dependencies.next) {
      return { declaredOnly: true, version: data.dependencies.next.replace(/[\^~>=]/g, '') };
    }
  }

  return null;
}

function runCheck() {
  console.log('===============================================================');
  console.log(' Next.js Security Advisory Floor Guard');
  console.log(' Verification Date: 2026-10-13');
  console.log('===============================================================');

  const resolved = findNextPackageJson();
  if (!resolved) {
    console.error('[ERROR] Unable to locate Next.js installation or package.json');
    process.exit(1);
  }

  let nextVersion;
  if (typeof resolved === 'string') {
    const pkg = JSON.parse(fs.readFileSync(resolved, 'utf8'));
    nextVersion = pkg.version;
    console.log(`Resolved Next.js package: ${resolved}`);
  } else {
    nextVersion = resolved.version;
    console.log(`Declared Next.js version in package.json: ${nextVersion}`);
  }

  console.log(`Detected Next.js version: ${nextVersion}`);

  const parsed = parseSemver(nextVersion);
  const rule = ADVISORY_RULES[parsed.major];

  if (!rule) {
    if (parsed.major > 16) {
      console.log(`[INFO] Next.js major version ${parsed.major} is newer than evaluated advisories (14-16). Proceeding with caution.`);
      process.exit(0);
    }
    console.error(`[FATAL] Next.js version ${nextVersion} (major: ${parsed.major}) has no security baseline rule defined.`);
    process.exit(1);
  }

  if (rule.status === 'DEPRECATED_VULNERABLE') {
    console.error(`[VULNERABLE] Next.js ${nextVersion} belongs to deprecated vulnerable line ${parsed.major}.x`);
    console.error(`Reason: ${rule.reason}`);
    console.error(`Known Advisories: ${rule.advisories.join(', ')}`);
    console.error('ACTION REQUIRED: Upgrade to supported maintained line (Next.js >= 15.5.24).');
    process.exit(1);
  }

  if (rule.minPatchedVersion) {
    const cmp = compareSemver(parsed, rule.minPatchedVersion);
    if (cmp < 0) {
      console.error(`[VULNERABLE] Next.js version ${nextVersion} is BELOW the required security floor ${rule.minPatchedVersion}!`);
      console.error(`Reason: ${rule.reason}`);
      console.error(`Known Advisories: ${rule.advisories.join(', ')}`);
      console.error(`ACTION REQUIRED: Upgrade Next.js to at least ${rule.minPatchedVersion}.`);
      process.exit(1);
    }

    console.log(`[PASSED] Next.js ${nextVersion} satisfies required security floor (>= ${rule.minPatchedVersion}).`);
    console.log(`Patched against advisories: ${rule.advisories.join(', ')}`);
    console.log('===============================================================');
    process.exit(0);
  }

  console.error('[FATAL] Indeterminate advisory floor evaluation.');
  process.exit(1);
}

runCheck();
