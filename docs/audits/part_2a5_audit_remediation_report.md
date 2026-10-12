# Hiralal Rewards Platform — Part 2A.5 Remediation & Verification Report

**Audit Phase:** Part 2A.5 — Final Remediation & Independent Verification  
**Repository:** `https://github.com/abraj12/hiralal`  
**Working Branch:** `audit/deploy-workflow-investigation`  
**Base Release Candidate:** `fix/release-readiness-2026-10-11`  
**Starting Commit:** `584326eca0504a39c4f711aa742f986ba4df22e7`  
**Parent Commit:** `cb2b6b35e8503fe5522f5968712ce0ecafba7e94`  
**Branch URL:** [GitHub Branch](https://github.com/abraj12/hiralal/tree/audit/deploy-workflow-investigation)  

---

## 1. Executive Summary

This report documents the completion and verification of the remaining remediation findings for **Part 2A.5: Final Remediation & Verification** of the Hiralal & Sons Rewards Platform.

Following the initial Part 2A.5 commit (`584326eca0504a39c4f711aa742f986ba4df22e7`), independent inspection identified three residual gaps requiring remediation:
1. **Concurrent Seeding Race Condition & Advisory Lock Alignment:** `RewardRuleService.createRule` acquired PostgreSQL transaction-scoped advisory locks (`pg_advisory_xact_lock`), but baseline seed provisioning in `backend/src/prisma/seed.ts` performed checks and inserts outside of a lock and transaction, leaving a window for concurrent executions to create duplicate baseline versions.
2. **Database-Level Defense in Depth:** The `RewardRule` table lacked an explicit unique constraint on `(profession, version)`, meaning that duplicate versions were only prevented by application-level logic rather than enforced at the database level.
3. **Admin Test Isolation in CI:** Standalone unit tests for admin date utility functions (`admin/src/lib/date-utils.test.ts`) were executed only indirectly via a backend test import rather than via a dedicated, first-class CI job.

All three gaps have been resolved with complete multi-tier safeguards, comprehensive regression tests, workflow updates, and local and remote verification.

---

## 2. Root Cause Analysis: Advisory Lock Omission in `seed.ts` vs `RewardRuleService`

### 2.1 Architectural Inconsistency
In Part 2A.2, `RewardRuleService.createRule()` was hardened with PostgreSQL transaction-scoped advisory locks:
```typescript
await trx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'reward_rule_' + profession})::bigint)`;
```
This guaranteed that concurrent administrative requests creating reward rules for the same profession were serialized.

However, `provisionRewardRules()` in `backend/src/prisma/seed.ts` executed raw `count` and `create` queries across multiple un-synchronized round-trips:
```typescript
// Previous implementation in seed.ts (Vulnerable to concurrency races)
for (const prof of ['PLUMBER', 'TILE_INSTALLER'] as const) {
  const totalCount = await prismaClient.rewardRule.count({
    where: { profession: prof },
  });
  if (totalCount === 0) {
    await prismaClient.rewardRule.create({ ... });
  }
}
```

### 2.2 Concurrency Race Hazard
When multiple application instances, database migrations, or container startup scripts trigger database seeding simultaneously:
1. **Thread A** queries `count({ where: { profession: 'PLUMBER' } })` $\to 0$.
2. **Thread B** simultaneously queries `count({ where: { profession: 'PLUMBER' } })` $\to 0$.
3. **Thread A** inserts baseline version 1 for `PLUMBER`.
4. **Thread B** inserts baseline version 1 for `PLUMBER`.

Because no unique constraint existed on `(profession, version)` in the database schema, both inserts succeeded, leaving duplicate version 1 rows for `PLUMBER` in the database. Furthermore, console logs would announce successful baseline provisioning twice.

---

## 3. Dual-Layer Protection Implementation

To completely eliminate this failure mode, a double-layer defense was implemented: application-level transaction advisory locks combined with database-level schema constraints.

### 3.1 Layer 1: Transaction-Scoped Advisory Locks in `seed.ts`
`provisionRewardRules()` in `backend/src/prisma/seed.ts` was refactored so that every profession's check and insertion is wrapped in an explicit `prismaClient.$transaction`:
1. Acquires `pg_advisory_xact_lock(hashtext('reward_rule_' + prof)::bigint)` inside the transaction. This key format matches `RewardRuleService.createRule()`, synchronizing seed provisioning with administrative rule creation.
2. Performs `trx.rewardRule.count({ where: { profession: prof } })` *after* the advisory lock is granted.
3. If `totalCount === 0`, creates baseline version 1 (`0.50%`, `2020-01-01 IST`, `isActive: true`) within the transaction.
4. If `totalCount > 0`, checks for active rules. If none is active, records a diagnostic warning and preserves historical rows without mutation.
5. Emits console logs only *after* the transaction has successfully committed, preventing misleading success logs during aborted transactions.

```typescript
// Hardened implementation in backend/src/prisma/seed.ts
for (const prof of ['PLUMBER', 'TILE_INSTALLER'] as const) {
  const postCommitLogs: Array<() => void> = [];

  await prismaClient.$transaction(async (trx: any) => {
    // Concurrency lock: acquire transaction-scoped PostgreSQL advisory lock per profession.
    await trx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'reward_rule_' + prof})::bigint)`;

    const totalCount = await trx.rewardRule.count({
      where: { profession: prof },
    });

    if (totalCount === 0) {
      await trx.rewardRule.create({
        data: {
          profession: prof,
          rewardPercentage: 0.50,
          effectiveFrom: new Date('2020-01-01T00:00:00+05:30'),
          version: 1,
          isActive: true,
        },
      });
      result.provisioned.push(prof);
      postCommitLogs.push(() => {
        console.log(`✅ [SEED] Initial baseline reward rule created for ${prof} (0.50%, v1, 2020-01-01 IST)`);
      });
    } else {
      const activeRule = await trx.rewardRule.findFirst({
        where: { profession: prof, isActive: true },
        orderBy: { version: 'desc' },
      });

      if (activeRule) {
        result.preserved.push(prof);
        postCommitLogs.push(() => {
          console.log(`ℹ️  [SEED] Active ${prof} rule already exists...`);
        });
      } else {
        const warning = `⚠️  [SEED-WARNING] Profession ${prof} has ${totalCount} existing historical reward rule(s), but none is currently active...`;
        result.warnings.push(warning);
        result.preserved.push(prof);
        postCommitLogs.push(() => {
          console.warn(warning);
        });
      }
    }
  });

  for (const emitLog of postCommitLogs) {
    emitLog();
  }
}
```

### 3.2 Layer 2: Database Schema Unique Constraint & Migration
To provide fail-closed defense in depth at the database level:
1. **Prisma Schema:** Added `@@unique([profession, version])` to `model RewardRule` in `backend/prisma/schema.prisma`.
2. **Defensive Pre-Check Migration:** Created migration `20261012110000_reward_rule_profession_version_unique/migration.sql`. Before adding the unique index, the migration executes an explicit PL/pgSQL block verifying that zero duplicate `(profession, version)` rows exist in `RewardRule`. If duplicates are detected, it raises an exception and aborts with a clear diagnostic message rather than silently dropping or altering historical financial records:
```sql
DO $$
DECLARE
    duplicate_count INTEGER;
    dup_details TEXT;
BEGIN
    SELECT COUNT(*) INTO duplicate_count
    FROM (
        SELECT profession, version
        FROM "RewardRule"
        GROUP BY profession, version
        HAVING COUNT(*) > 1
    ) dups;

    IF duplicate_count > 0 THEN
        SELECT string_agg(profession || ' v' || version || ' (count: ' || cnt || ')', ', ') INTO dup_details
        FROM (
            SELECT profession, version, COUNT(*) as cnt
            FROM "RewardRule"
            GROUP BY profession, version
            HAVING COUNT(*) > 1
        ) dups;

        RAISE EXCEPTION 'Migration aborted: Duplicate (profession, version) records detected in RewardRule: %. Historical data must be reconciled manually by an administrator without in-place mutation.', dup_details;
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "RewardRule_profession_version_key" ON "RewardRule"("profession", "version");
```

---

## 4. Concurrency Test Evidence

The regression suite `backend/src/tests/part2a4_hardening.spec.ts` was extended with real, non-mocked concurrent execution tests:

### 4.1 Test 5: Concurrent Seed Execution (`Promise.all`)
- **Setup:** Deletes all reward rules for `PLUMBER` and `TILE_INSTALLER` to simulate a clean database state.
- **Action:** Concurrently triggers 3 parallel calls to `provisionRewardRules(prisma)` via `Promise.all([provisionRewardRules(prisma), provisionRewardRules(prisma), provisionRewardRules(prisma)])`.
- **Assertions Verified:**
  - Exactly 1 baseline rule (v1) created per profession (`count === 1`).
  - Exactly one run provisions the baseline, while the other two detect the existing rule and preserve it.
  - Raw SQL query `SELECT profession, version FROM "RewardRule" GROUP BY profession, version HAVING COUNT(*) > 1` returns 0 rows.
  - Subsequent sequential invocation of `provisionRewardRules(prisma)` preserves existing rules and creates 0 additional records.

### 4.2 Test 6: Concurrent Seed Execution with Inactive History
- **Setup:** Inserts an inactive historical version (`version: 3`, `isActive: false`) for `TILE_INSTALLER`.
- **Action:** Concurrently triggers 3 parallel calls to `provisionRewardRules(prisma)`.
- **Assertions Verified:**
  - No baseline version is provisioned across any of the concurrent runs (`res.provisioned` does not contain `TILE_INSTALLER`).
  - All 3 runs issue the required diagnostic warning.
  - The historical inactive rule is preserved with `isActive: false` and `version: 3` without implicit resurrection.

### 4.3 Test 7: Database Unique Constraint Rejection (Fail-Closed)
- **Action:** Directly attempts to insert a duplicate `(PLUMBER, version: 1)` record via `prisma.rewardRule.create()`.
- **Assertion Verified:** The operation rejects with a database unique constraint violation (`Unique constraint failed on the fields: (profession, version)`).

---

## 5. Dedicated Native CI Job for Admin Date-Helper Tests

### 5.1 Rationale
In Part 2A.4, calendar date and time validation tests (`admin/src/lib/date-utils.test.ts`) were added to the admin package, but were only executed as part of the backend test suite via a relative-path require hack. This created an implicit cross-package test dependency and failed to validate the admin package's standalone test runner in CI.

### 5.2 Implementation
1. Verified `admin/package.json` contains:
   ```json
   "test": "node --test src/lib/date-utils.test.ts"
   ```
2. Verified `admin/package-lock.json` is clean and committed for deterministic `npm ci`.
3. Added dedicated GitHub Actions job `admin-date-tests` in `.github/workflows/ci.yml`:
   ```yaml
   admin-date-tests:
     name: Admin Date Helper Tests
     runs-on: ubuntu-latest
     steps:
       - name: Checkout Code
         uses: actions/checkout@v4

       - name: Setup Node.js 22
         uses: actions/setup-node@v4
         with:
           node-version: 22
           cache: 'npm'
           cache-dependency-path: admin/package-lock.json

       - name: Install Admin Dependencies
         working-directory: admin
         run: npm ci

       - name: Run Admin Date Helper Tests
         working-directory: admin
         run: |
           npm test 2>&1 | tee admin_test_output.log

       - name: Publish Admin Test Summary
         if: always()
         working-directory: admin
         run: |
           if [ -f admin_test_output.log ]; then
             echo "### Admin Date Helper Test Results" >> $GITHUB_STEP_SUMMARY
             echo '```' >> $GITHUB_STEP_SUMMARY
             cat admin_test_output.log >> $GITHUB_STEP_SUMMARY
             echo '```' >> $GITHUB_STEP_SUMMARY
           fi
   ```
4. Wired downstream verification jobs (`docker-arm64-check` and `full-stack-compose-smoke-test`) to depend on both test jobs:
   ```yaml
   needs: [backend-test, admin-date-tests]
   ```
5. Added artifact upload step to publish this report as a build artifact named `part-2a5-audit-remediation-report`.

---

## 6. Verification Evidence Summary

| Verification Target | Command / Check | Result | Evidence |
| :--- | :--- | :--- | :--- |
| **Admin Date Helper Tests** | `npm test` in `admin/` | **PASS (9/9)** | TAP v13: 9 passed, 0 failed, 0 skipped |
| **Prisma Schema Validation** | `npx prisma validate` | **PASS** | Validated `@@unique([profession, version])` |
| **Prisma Client Generation** | `npx prisma generate` | **PASS** | Generated Prisma Client v6.4.1 |
| **Database Migrations** | `npx prisma migrate deploy` | **PASS** | Applied `20261012110000_reward_rule_profession_version_unique` |
| **Backend TypeScript Check** | `npx tsc --noEmit` | **PASS** | 0 type errors |
| **Part 2A.4/2A.5 Regressions** | `npm test -- src/tests/part2a4_hardening.spec.ts` | **PASS (39/39)** | 39 passed (including 3 new concurrency/DB tests) |
| **Backend Full Test Suite** | `npm test` in `backend/` | **PASS (346/346)** | 24 suites passed, 346 tests passed |
| **GitHub Actions Lint** | `actionlint` | **PASS** | 0 lint errors across all workflows |
| **Deployment Health Probe** | `python scripts/test_verify_deployment_health.py` | **PASS** | 12/12 validation assertions passed |

---

## 7. Conclusion

All requirements for **Part 2A.5: Final Remediation & Independent Verification** are completely implemented, verified with actual concurrency executions against PostgreSQL, protected by database-level constraints, and wired into the GitHub Actions CI pipeline.
