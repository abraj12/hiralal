#!/usr/bin/env bash
# ==============================================================================
# Hiralal & Sons Rewards Platform — Pinned & Verified Bundletool AAB Verifier
# ==============================================================================
set -euo pipefail

BUNDLETOOL_VERSION="1.17.1"
BUNDLETOOL_EXPECTED_SHA256="45881ead13388872d82c4255b195488b7fc33f2cac5a9a977b0afc5e92367592"
CACHE_DIR="${RUNNER_TEMP:-/tmp}"
BUNDLETOOL_PATH="${CACHE_DIR}/bundletool-all-${BUNDLETOOL_VERSION}.jar"

EXPECTED_PKG="com.hiralal.rewards"
AAB_PATH="${1:-}"

# 1. Require valid input path
if [ -z "$AAB_PATH" ]; then
  echo "::error::AAB file path is required as first argument." >&2
  exit 1
fi

if [ ! -f "$AAB_PATH" ]; then
  echo "::error::AAB file does not exist at '${AAB_PATH}'." >&2
  exit 1
fi

# 2. Check or download bundletool with retry
if [ ! -f "${BUNDLETOOL_PATH}" ]; then
  echo "Downloading bundletool ${BUNDLETOOL_VERSION}..."
  curl --fail --show-error --location \
    "https://github.com/google/bundletool/releases/download/${BUNDLETOOL_VERSION}/bundletool-all-${BUNDLETOOL_VERSION}.jar" \
    --output "${BUNDLETOOL_PATH}" || {
      echo "::error::Failed to download bundletool from official release repository." >&2
      exit 1
    }
fi

# 3. Checksum verification against pinned official SHA-256
echo "${BUNDLETOOL_EXPECTED_SHA256}  ${BUNDLETOOL_PATH}" | sha256sum --check --status || {
  echo "::error::bundletool SHA-256 verification failed! Corrupt or untrusted binary detected." >&2
  rm -f "${BUNDLETOOL_PATH}"
  exit 1
}
echo "Verified bundletool SHA-256 digest: ${BUNDLETOOL_EXPECTED_SHA256}"

# 4. Extract manifest using verified bundletool
if ! command -v java &>/dev/null; then
  echo "::error::Java runtime is required to execute bundletool." >&2
  exit 1
fi

AAB_MANIFEST="$(java -jar "${BUNDLETOOL_PATH}" dump manifest --bundle="$AAB_PATH" 2>/dev/null || true)"
ACTUAL_PKG="$(echo "$AAB_MANIFEST" | grep -oP 'package="\K[^"]+' || echo "$AAB_MANIFEST" | grep -oP "package: name='\K[^']+" || true)"

if [ -z "$ACTUAL_PKG" ]; then
  echo "::error::Failed to extract package name from AAB (${AAB_PATH}). Failing closed." >&2
  exit 1
fi

if [ "$ACTUAL_PKG" != "$EXPECTED_PKG" ]; then
  echo "::error::AAB package name is '${ACTUAL_PKG}', expected '${EXPECTED_PKG}'!" >&2
  exit 1
fi

echo "Verified AAB package name from binary manifest: ${ACTUAL_PKG}"
