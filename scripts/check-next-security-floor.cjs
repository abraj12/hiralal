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
 * - < 15.x: Unmaintained / vulnerable. All < 15 versions rejected.
 * - 15.x: >= 15.5.24 required.
 * - 16.x: >= 16.3.0 required.
 * - 17.x+: Unaudited future major versions. Fails closed (rejected).
 * - Prereleases (canary, rc, beta): Fails closed (rejected).
 */

const fs = require('fs');
const path = require('path');

function parseSemver(v) {
  if (!v || typeof v !== 'string') {
    throw new Error(`Invalid version input: ${v}`);
  }
  const clean = v.trim().replace(/^v/, '');
  if (!clean) {
    throw new Error('Empty version string');
  }
  const [main, prerelease] = clean.split('-');
  const parts = main.split('.');
  if (parts.length !== 3) {
    throw new Error(`Invalid semver format: "${v}"`);
  }
  const [major, minor, patch] = parts.map((p) => {
    if (!/^\d+$/.test(p)) {
      throw new Error(`Invalid integer part in semver: "${p}"`);
    }
    return parseInt(p, 10);
  });
  if (isNaN(major) || isNaN(minor) || isNaN(patch)) {
    throw new Error(`Invalid semver format: "${v}"`);
  }
  return {
    major,
    minor,
    patch,
    prerelease: prerelease ? prerelease.trim() : null,
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
    reason: 'Next.js 14.x and below are affected by unpatched advisories (CVE-2025-29927, GHSA-2xp9-vwfh-vxw4, GHSA-p293-qw3h-jr36). Must upgrade to maintained 15.x patched line.',
    advisories: ['CVE-2025-29927', 'GHSA-2xp9-vwfh-vxw4', 'GHSA-p293-qw3h-jr36', 'GHSA-p9j2-gv94-2wf4', 'GHSA-vcvr-r3jv-pc5j'],
  },
  15: {
    status: 'MAINTAINED',
    minPatchedVersion: '15.5.24',
    reason: 'Versions below 15.5.24 are affected by GHSA-2xp9-vwfh-vxw4 (critical image-optimization and Windows-hosted advisories), GHSA-p293-qw3h-jr36, GHSA-p9j2-gv94-2wf4, GHSA-vcvr-r3jv-pc5j.',
    advisories: ['GHSA-2xp9-vwfh-vxw4', 'GHSA-p293-qw3h-jr36', 'GHSA-p9j2-gv94-2wf4', 'GHSA-vcvr-r3jv-pc5j'],
  },
  16: {
    status: 'MAINTAINED',
    minPatchedVersion: '16.3.0',
    reason: 'Versions below 16.3.0 are affected by GHSA-p9j2-gv94-2wf4 (next/og critical remote code execution / buffer overflow advisory).',
    advisories: ['GHSA-p9j2-gv94-2wf4'],
  },
};

function evaluateVersion(versionString) {
  let parsed;
  try {
    parsed = parseSemver(versionString);
  } catch (err) {
    return {
      ok: false,
      status: 'INVALID_VERSION',
      version: versionString,
      reason: `Version string "${versionString}" could not be parsed as valid semver: ${err.message}`,
    };
  }

  // Fail closed on prerelease tags
  if (parsed.prerelease) {
    return {
      ok: false,
      status: 'PRERELEASE_FORBIDDEN',
      version: versionString,
      reason: `Prerelease version "${versionString}" has tag "${parsed.prerelease}". Prerelease and release-candidate builds are forbidden in production.`,
    };
  }

  // Reject deprecated major versions (< 15)
  if (parsed.major < 15) {
    const rule = ADVISORY_RULES[14];
    return {
      ok: false,
      status: 'DEPRECATED_VULNERABLE',
      version: versionString,
      advisories: rule.advisories,
      reason: `Next.js ${versionString} belongs to deprecated vulnerable line ${parsed.major}.x. ${rule.reason}`,
    };
  }

  // Reject unreviewed future major versions (>= 17)
  if (parsed.major >= 17) {
    return {
      ok: false,
      status: 'UNKNOWN_FUTURE_MAJOR',
      version: versionString,
      reason: `Next.js major version ${parsed.major} is unreviewed. Production safety policy fails closed on major versions >= 17 until an audited security floor is established.`,
    };
  }

  const rule = ADVISORY_RULES[parsed.major];
  if (!rule || !rule.minPatchedVersion) {
    return {
      ok: false,
      status: 'INDETERMINATE_RULE',
      version: versionString,
      reason: `No advisory floor rule defined for Next.js major version ${parsed.major}.`,
    };
  }

  const cmp = compareSemver(parsed, rule.minPatchedVersion);
  if (cmp < 0) {
    return {
      ok: false,
      status: 'BELOW_SECURITY_FLOOR',
      version: versionString,
      minPatchedVersion: rule.minPatchedVersion,
      advisories: rule.advisories,
      reason: `Next.js version ${versionString} is BELOW the required security floor ${rule.minPatchedVersion}. ${rule.reason}`,
    };
  }

  return {
    ok: true,
    status: 'PASSED',
    version: versionString,
    minPatchedVersion: rule.minPatchedVersion,
    advisories: rule.advisories,
    reason: `Next.js ${versionString} satisfies required security floor (>= ${rule.minPatchedVersion}).`,
  };
}

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

  const evaluation = evaluateVersion(nextVersion);

  if (!evaluation.ok) {
    console.error(`[FATAL ERROR] Next.js Security Floor Check FAILED!`);
    console.error(`Status: ${evaluation.status}`);
    console.error(`Reason: ${evaluation.reason}`);
    if (evaluation.advisories && evaluation.advisories.length > 0) {
      console.error(`Known Advisories: ${evaluation.advisories.join(', ')}`);
    }
    if (evaluation.minPatchedVersion) {
      console.error(`ACTION REQUIRED: Upgrade Next.js to at least ${evaluation.minPatchedVersion}.`);
    }
    process.exit(1);
  }

  console.log(`[PASSED] ${evaluation.reason}`);
  if (evaluation.advisories && evaluation.advisories.length > 0) {
    console.log(`Patched against advisories: ${evaluation.advisories.join(', ')}`);
  }
  console.log('===============================================================');
  process.exit(0);
}

if (require.main === module) {
  runCheck();
}

module.exports = {
  parseSemver,
  compareSemver,
  evaluateVersion,
  findNextPackageJson,
  runCheck,
  ADVISORY_RULES,
};
