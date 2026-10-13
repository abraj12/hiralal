#!/usr/bin/env bash
# ==============================================================================
# Hiralal & Sons Rewards Platform — Automated Release Rollback Controller
# Platform: AWS EC2 t4g.medium (linux/arm64, Graviton2, ap-south-1)
# ==============================================================================
# Invariant Guarantees:
# 1. Forward-only database schema preservation: NEVER restore snapshots over live writes.
# 2. Strict migration compatibility gate: evaluate deployment-compatibility.json.
#    If breaking schema migrations were applied, BLOCK app rollback and fail closed.
# 3. Deterministic image restoration using immutable tags: hiralal-*:${PREVIOUS_SHA}.
# 4. Post-rollback health verification via verify-deployment-health.py.
# 5. Non-secret deployment state recording in /opt/hiralal/deployment-state.
# ==============================================================================

set -euo pipefail

fail() {
  printf '[ROLLBACK BLOCKED] %s\n' "$*" >&2
  exit 1
}

PREVIOUS_SHA="${1:-${PREVIOUS_SHA:-}}"
TARGET_SHA="${2:-${TARGET_SHA:-}}"
APP_DIR="${APP_DIR:-$(pwd)}"
STATE_DIR="${APP_DIR}/deployment-state"
COMPATIBILITY_MANIFEST="${APP_DIR}/backend/prisma/migrations/deployment-compatibility.json"
HEALTH_SCRIPT="${APP_DIR}/scripts/verify-deployment-health.py"

echo "=================================================================="
echo "Hiralal & Sons — Automated Application Rollback Controller"
echo "Target Failed SHA:    ${TARGET_SHA:-UNKNOWN}"
echo "Previous Release SHA: ${PREVIOUS_SHA:-UNKNOWN}"
echo "Working Directory:    ${APP_DIR}"
echo "=================================================================="

# 1. Identity validation (strict fail-closed checks per Phase G.7 Workstream B1)
[[ -n "${PREVIOUS_SHA:-}" ]] || fail "PREVIOUS_SHA is required"
[[ -n "${TARGET_SHA:-}" ]] || fail "TARGET_SHA is required"

# Normalize uppercase hex input to lowercase
PREVIOUS_SHA="$(echo "${PREVIOUS_SHA}" | tr '[:upper:]' '[:lower:]')"
TARGET_SHA="$(echo "${TARGET_SHA}" | tr '[:upper:]' '[:lower:]')"

if [[ "${PREVIOUS_SHA}" == "none" ]]; then
  fail "Cannot roll back first deployment: PREVIOUS_SHA is NONE (no prior established release exists to roll back to)"
fi

[[ "${PREVIOUS_SHA}" != "${TARGET_SHA}" ]] ||
  fail "Previous and failed candidate release SHAs are identical (${TARGET_SHA})"

require_commit() {
  local sha="$1"
  local label="$2"

  [[ "$sha" =~ ^[0-9a-f]{40}$ ]] ||
    fail "${label} must be a full 40-character lowercase commit SHA (got: '${sha}')"

  git cat-file -e "${sha}^{commit}" 2>/dev/null ||
    fail "${label} commit ${sha} is unavailable in git history"
}

require_commit "${PREVIOUS_SHA}" "PREVIOUS_SHA"
require_commit "${TARGET_SHA}" "TARGET_SHA"

# 2. Migration compatibility evaluation gate (fail closed on breaking changes)
echo "Evaluating database schema migration compatibility..."
if [ ! -f "${COMPATIBILITY_MANIFEST}" ]; then
  fail "Migration compatibility manifest not found at ${COMPATIBILITY_MANIFEST}."
fi

# Validate manifest JSON structure
node -e "
  const fs = require('fs');
  const m = JSON.parse(fs.readFileSync('${COMPATIBILITY_MANIFEST}', 'utf8'));
  if (!Array.isArray(m.migrations) || m.migrations.length === 0) {
    throw new Error('Manifest missing or empty migrations array');
  }
" 2>/dev/null || fail "Migration compatibility manifest at ${COMPATIBILITY_MANIFEST} is malformed or invalid JSON."

# Determine migrations introduced between PREVIOUS_SHA and TARGET_SHA
# Git diff MUST succeed (never suppress error with || true)
if ! DIFF_OUTPUT=$(git diff --name-only "${PREVIOUS_SHA}" "${TARGET_SHA}" -- backend/prisma/migrations/ 2>&1); then
  fail "Git diff failed between ${PREVIOUS_SHA} and ${TARGET_SHA}: ${DIFF_OUTPUT}"
fi

NEW_MIGRATION_DIRS=$(echo "${DIFF_OUTPUT}" | grep -E '^backend/prisma/migrations/[^/]+/' | awk -F'/' '{print $4}' | sort -u || true)

BREAKING_FOUND=0
BREAKING_MIGRATIONS=()

if [ -n "${NEW_MIGRATION_DIRS}" ]; then
  echo "Inspecting migration deltas: ${NEW_MIGRATION_DIRS}"
  for mig in ${NEW_MIGRATION_DIRS}; do
    IS_COMPAT=$(node -e "
      const m = require('${COMPATIBILITY_MANIFEST}');
      const entry = m.migrations.find(x => x.id === '${mig}');
      if (!entry) {
        console.log('UNKNOWN');
      } else if (entry.isBackwardCompatible === false || entry.allowsApplicationRollback === false || entry.destructive === true) {
        console.log('BREAKING:' + (entry.breakingChanges ? entry.breakingChanges.join('; ') : 'incompatible'));
      } else {
        console.log('COMPATIBLE');
      }
    " 2>/dev/null || echo "UNKNOWN")

    if [[ "${IS_COMPAT}" == BREAKING* ]]; then
      BREAKING_FOUND=1
      BREAKING_MIGRATIONS+=("${mig} (${IS_COMPAT})")
    elif [ "${IS_COMPAT}" = "UNKNOWN" ]; then
      BREAKING_FOUND=1
      BREAKING_MIGRATIONS+=("${mig} (Unknown migration uncataloged in compatibility manifest)")
    fi
  done
else
  echo "No schema migration differences detected between ${PREVIOUS_SHA} and ${TARGET_SHA}."
fi

# Also check applied migrations from database or override
if [ -n "${OVERRIDE_APPLIED_MIGRATIONS:-}" ]; then
  IFS=',' read -r -a APPLIED_LIST <<< "${OVERRIDE_APPLIED_MIGRATIONS}"
  for app_mig in "${APPLIED_LIST[@]}"; do
    app_mig="$(echo "$app_mig" | tr -d ' ')"
    [ -z "$app_mig" ] && continue
    # If applied migration was NOT in PREVIOUS_SHA, it must be evaluated
    if ! git cat-file -e "${PREVIOUS_SHA}:backend/prisma/migrations/${app_mig}/migration.sql" 2>/dev/null; then
      IS_COMPAT=$(node -e "
        const m = require('${COMPATIBILITY_MANIFEST}');
        const entry = m.migrations.find(x => x.id === '${app_mig}');
        if (!entry) {
          console.log('UNKNOWN');
        } else if (entry.isBackwardCompatible === false || entry.allowsApplicationRollback === false || entry.destructive === true) {
          console.log('BREAKING:' + (entry.breakingChanges ? entry.breakingChanges.join('; ') : 'incompatible'));
        } else {
          console.log('COMPATIBLE');
        }
      " 2>/dev/null || echo "UNKNOWN")

      if [[ "${IS_COMPAT}" == BREAKING* ]]; then
        BREAKING_FOUND=1
        BREAKING_MIGRATIONS+=("${app_mig} (Applied migration is breaking: ${IS_COMPAT})")
      elif [ "${IS_COMPAT}" = "UNKNOWN" ]; then
        BREAKING_FOUND=1
        BREAKING_MIGRATIONS+=("${app_mig} (Applied migration uncataloged in compatibility manifest)")
      fi
    fi
  done
fi

if [ ${BREAKING_FOUND} -ne 0 ]; then
  echo "==================================================================" >&2
  echo "[CRITICAL ALERT] AUTOMATIC APPLICATION ROLLBACK BLOCKED BY COMPATIBILITY GATE!" >&2
  echo "Reason: The newly applied database migrations contain breaking changes:" >&2
  for bm in "${BREAKING_MIGRATIONS[@]}"; do
    echo "  - ${bm}" >&2
  done
  echo "" >&2
  echo "POLICY ENFORCEMENT:" >&2
  echo "1. Database schema is preserved FORWARD-ONLY." >&2
  echo "2. NEVER restore a database snapshot over live writes or in-flight transactions." >&2
  echo "3. Previous application code at ${PREVIOUS_SHA} is NOT compatible with current database schema." >&2
  echo "4. Immediate manual operator intervention is required to fix the forward release." >&2
  echo "==================================================================" >&2
  exit 1
fi

echo "Migration compatibility verified: all migrations between ${PREVIOUS_SHA} and ${TARGET_SHA} permit application rollback."

# 3. Check for dry-run simulation mode (useful for unit testing and CI verification)
if [ "${ROLLBACK_DRY_RUN:-false}" = "true" ]; then
  echo "[ROLLBACK DRY-RUN] All preconditions and compatibility checks PASSED."
  exit 0
fi

# 4. Verify retained previous image existence
if command -v docker >/dev/null 2>&1; then
  for svc in backend worker admin; do
    IMG="hiralal-${svc}:${PREVIOUS_SHA}"
    if ! docker image inspect "${IMG}" >/dev/null 2>&1; then
      fail "Retained previous image ${IMG} is missing or unavailable. Cannot safely rollback."
    fi
  done
fi

# 5. Checkout previous commit in git repository
echo "Checking out previous commit ${PREVIOUS_SHA}..."
git checkout "${PREVIOUS_SHA}"

# 6. Restore application containers using immutable image tag
echo "Restoring application container stack using image tag: ${PREVIOUS_SHA}..."
export HIRALAL_IMAGE_TAG="${PREVIOUS_SHA}"

docker compose up -d backend worker admin nginx

# 7. Verify health of restored application stack
echo "Verifying health and readiness of restored application..."
sleep 10

HEALTH_URL="http://localhost/health"
READY_URL="http://localhost/health/ready"

HEALTH_JSON="$(curl --fail --silent --show-error "${HEALTH_URL}" 2>/dev/null || echo '{"status":"down"}')"
READY_JSON="$(curl --fail --silent --show-error "${READY_URL}" 2>/dev/null || echo '{"status":"unready","checks":{}}')"

if python3 "${HEALTH_SCRIPT}" "${HEALTH_JSON}" "${READY_JSON}"; then
  echo "=================================================================="
  echo "[ROLLBACK SUCCESS] Application successfully restored to ${PREVIOUS_SHA}!"
  echo "Database schema preserved forward-only. No live writes were lost."
  echo "=================================================================="

  # Update deployment state record atomically using printf
  mkdir -p "${STATE_DIR}"
  STATE_TMP="$(mktemp "${STATE_DIR}/active-release.json.XXXXXX")"
  RESTORED_AT="$(date -u +'%Y-%m-%dT%H:%M:%SZ')"

  printf '{\n  "releaseId": "%s",\n  "gitSha": "%s",\n  "restoredAt": "%s",\n  "status": "RESTORED_AFTER_FAILURE",\n  "failedCandidate": "%s",\n  "images": {\n    "backend": "hiralal-backend:%s",\n    "worker": "hiralal-worker:%s",\n    "admin": "hiralal-admin:%s"\n  }\n}\n' \
    "${PREVIOUS_SHA}" \
    "${PREVIOUS_SHA}" \
    "${RESTORED_AT}" \
    "${TARGET_SHA}" \
    "${PREVIOUS_SHA}" \
    "${PREVIOUS_SHA}" \
    "${PREVIOUS_SHA}" > "${STATE_TMP}"

  node -e '
    const fs = require("fs");
    JSON.parse(fs.readFileSync(0, "utf8"));
  ' < "${STATE_TMP}"

  chmod 600 "${STATE_TMP}"
  mv "${STATE_TMP}" "${STATE_DIR}/active-release.json"

  exit 0
else
  echo "==================================================================" >&2
  echo "[CRITICAL ALERT] Restored release ${PREVIOUS_SHA} failed post-startup health checks!" >&2
  echo "Manual triage and operator intervention required immediately!" >&2
  echo "==================================================================" >&2
  exit 1
fi
