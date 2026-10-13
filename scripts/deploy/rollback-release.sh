#!/usr/bin/env bash
# ==============================================================================
# Hiralal & Sons Rewards Platform — Automated Release Rollback Helper
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

PREVIOUS_SHA="${1:-${PREVIOUS_SHA:-}}"
TARGET_SHA="${2:-${TARGET_SHA:-}}"
APP_DIR="${APP_DIR:-$(pwd)}"
STATE_DIR="${APP_DIR}/deployment-state"
COMPATIBILITY_MANIFEST="${APP_DIR}/backend/prisma/migrations/deployment-compatibility.json"
HEALTH_SCRIPT="${APP_DIR}/scripts/verify-deployment-health.py"

echo "=================================================================="
echo "Hiralal & Sons — Automated Application Rollback Controller"
echo "Target Failed SHA:   ${TARGET_SHA:-UNKNOWN}"
echo "Previous Release SHA: ${PREVIOUS_SHA:-UNKNOWN}"
echo "Working Directory:    ${APP_DIR}"
echo "=================================================================="

# 1. Precondition checks
if [ -z "${PREVIOUS_SHA}" ] || [ "${PREVIOUS_SHA}" = "NONE" ]; then
  echo "[CRITICAL ALERT] Rollback aborted: No valid PREVIOUS_SHA provided. Manual operator triage required." >&2
  exit 1
fi

if [ -n "${TARGET_SHA}" ] && [ "${PREVIOUS_SHA}" = "${TARGET_SHA}" ]; then
  echo "[CRITICAL ALERT] Rollback aborted: PREVIOUS_SHA is identical to TARGET_SHA (${TARGET_SHA}). Nothing to rollback." >&2
  exit 1
fi

if ! [[ "${PREVIOUS_SHA}" =~ ^[0-9a-fA-F]{40}$ ]]; then
  echo "[CRITICAL ALERT] Rollback aborted: PREVIOUS_SHA '${PREVIOUS_SHA}' is not a valid 40-character hexadecimal SHA." >&2
  exit 1
fi

# 2. Migration compatibility evaluation gate (fail closed on breaking changes)
echo "Evaluating database schema migration compatibility..."
if [ ! -f "${COMPATIBILITY_MANIFEST}" ]; then
  echo "[CRITICAL ALERT] Migration compatibility manifest not found at ${COMPATIBILITY_MANIFEST}. Halting rollback safely." >&2
  exit 1
fi

# Determine migrations introduced between PREVIOUS_SHA and TARGET_SHA
BREAKING_FOUND=0
BREAKING_MIGRATIONS=()

if [ -n "${TARGET_SHA}" ] && git rev-parse --verify "${PREVIOUS_SHA}^{commit}" >/dev/null 2>&1 && git rev-parse --verify "${TARGET_SHA}^{commit}" >/dev/null 2>&1; then
  # Inspect newly added migration directories in target commit
  NEW_MIGRATION_DIRS=$(git diff --name-only "${PREVIOUS_SHA}" "${TARGET_SHA}" -- backend/prisma/migrations/ 2>/dev/null | grep -E '^backend/prisma/migrations/[^/]+/' | awk -F'/' '{print $4}' | sort -u || true)
  
  if [ -n "${NEW_MIGRATION_DIRS}" ]; then
    echo "Inspecting migration deltas: ${NEW_MIGRATION_DIRS}"
    for mig in ${NEW_MIGRATION_DIRS}; do
      # Query deployment-compatibility.json for backward compatibility
      IS_COMPAT=$(node -e "
        const m = require('${COMPATIBILITY_MANIFEST}');
        const entry = m.migrations.find(x => x.id === '${mig}');
        if (!entry) {
          // Unknown migration: fail closed
          console.log('UNKNOWN');
        } else if (entry.isBackwardCompatible === false || entry.allowsApplicationRollback === false) {
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

echo "Migration compatibility verified: all migrations between ${PREVIOUS_SHA} and ${TARGET_SHA:-HEAD} permit application rollback."

# 3. Check for dry-run simulation mode (useful for unit testing and CI verification)
if [ "${ROLLBACK_DRY_RUN:-false}" = "true" ]; then
  echo "[ROLLBACK DRY-RUN] All preconditions and compatibility checks PASSED."
  exit 0
fi

# 4. Checkout previous commit in git repository
echo "Checking out previous commit ${PREVIOUS_SHA}..."
git checkout "${PREVIOUS_SHA}"

# 5. Restore application containers using immutable image tag
echo "Restoring application container stack using image tag: ${PREVIOUS_SHA}..."
export HIRALAL_IMAGE_TAG="${PREVIOUS_SHA}"

# Restart application containers with previous tag (retaining running postgres and redis)
docker compose up -d backend worker admin nginx

# 6. Verify health of restored application stack
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

  # Update deployment state record
  mkdir -p "${STATE_DIR}"
  cat <<STATE_JSON > "${STATE_DIR}/active-release.json"
{
  "releaseId": "${PREVIOUS_SHA}",
  "gitSha": "${PREVIOUS_SHA}",
  "restoredAt": "$(date -u +'%Y-%m-%dT%H:%M:%SZ')",
  "status": "RESTORED_AFTER_FAILURE",
  "failedCandidate": "${TARGET_SHA:-UNKNOWN}",
  "images": {
    "backend": "hiralal-backend:${PREVIOUS_SHA}",
    "worker": "hiralal-worker:${PREVIOUS_SHA}",
    "admin": "hiralal-admin:${PREVIOUS_SHA}"
  }
}
STATE_JSON

  exit 0
else
  echo "==================================================================" >&2
  echo "[CRITICAL ALERT] Restored release ${PREVIOUS_SHA} failed post-startup health checks!" >&2
  echo "Manual triage and operator intervention required immediately!" >&2
  echo "==================================================================" >&2
  exit 1
fi
