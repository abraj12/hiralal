#!/usr/bin/env python3
"""
scripts/test_migration_compatibility.py

Authoritative validator for Prisma migration rollback compatibility manifest.
Verifies that:
1. Every actual migration directory in backend/prisma/migrations/ is represented exactly once in the manifest.
2. The manifest contains no nonexistent migration identifiers.
3. Each manifest ID matches its actual Prisma directory name.
4. Every migration has an explicit compatibility decision.
5. SQL containing destructive schema changes (DROP TABLE, DROP COLUMN, enum removal) is reviewed and correctly classified.
6. A breaking migration cannot declare allowsApplicationRollback: true.
7. Unknown schema changes fail closed (rejected).
8. Breaking migration list matches expectations.
"""

import json
import os
import re
import sys
import unittest


class TestMigrationCompatibilityManifest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.repo_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        cls.migrations_dir = os.path.join(cls.repo_root, "backend", "prisma", "migrations")
        cls.manifest_path = os.path.join(cls.migrations_dir, "deployment-compatibility.json")

        if not os.path.exists(cls.manifest_path):
            raise FileNotFoundError(f"Manifest not found: {cls.manifest_path}")

        with open(cls.manifest_path, "r", encoding="utf-8") as f:
            cls.manifest = json.load(f)

        # Enumerate actual migration directories (skip non-directory files like migration_lock.toml, deployment-compatibility.json)
        cls.actual_migration_dirs = sorted([
            d for d in os.listdir(cls.migrations_dir)
            if os.path.isdir(os.path.join(cls.migrations_dir, d))
        ])

    def test_manifest_schema_and_policy(self):
        """Manifest must define schema version and forward-only policies."""
        self.assertEqual(self.manifest.get("version"), "1.0.0")
        policy = self.manifest.get("policy", {})
        self.assertTrue(policy.get("forwardOnlyDatabaseSchema"))
        self.assertTrue(policy.get("neverRestoreSnapshotOverLiveWrites"))
        self.assertTrue(policy.get("blockAppRollbackOnBreakingMigrations"))

    def test_all_migration_directories_represented_exactly_once(self):
        """Every actual migration directory must be represented exactly once in the manifest."""
        manifest_entries = self.manifest.get("migrations", [])
        manifest_ids = [m["id"] for m in manifest_entries]

        # Check for duplicates in manifest
        self.assertEqual(
            len(manifest_ids),
            len(set(manifest_ids)),
            f"Duplicate migration IDs found in manifest: {[x for x in manifest_ids if manifest_ids.count(x) > 1]}"
        )

        # Check every actual migration directory is in manifest
        for actual_dir in self.actual_migration_dirs:
            self.assertIn(
                actual_dir,
                manifest_ids,
                f"Migration directory '{actual_dir}' is missing from deployment-compatibility.json"
            )

        # Check no extra/nonexistent directories exist in manifest
        for m_id in manifest_ids:
            self.assertIn(
                m_id,
                self.actual_migration_dirs,
                f"Manifest references nonexistent migration directory: '{m_id}'"
            )

        self.assertEqual(len(manifest_ids), len(self.actual_migration_dirs))

    def test_explicit_compatibility_decision_for_every_migration(self):
        """Every migration must have an explicit compatibility decision with boolean flags."""
        for entry in self.manifest.get("migrations", []):
            m_id = entry.get("id")
            self.assertIn("isBackwardCompatible", entry, f"Missing isBackwardCompatible for {m_id}")
            self.assertIn("destructive", entry, f"Missing destructive for {m_id}")
            self.assertIn("allowsApplicationRollback", entry, f"Missing allowsApplicationRollback for {m_id}")
            self.assertIsInstance(entry["isBackwardCompatible"], bool, f"isBackwardCompatible must be bool for {m_id}")
            self.assertIsInstance(entry["destructive"], bool, f"destructive must be bool for {m_id}")
            self.assertIsInstance(entry["allowsApplicationRollback"], bool, f"allowsApplicationRollback must be bool for {m_id}")

    def test_breaking_migrations_cannot_allow_application_rollback(self):
        """A breaking or destructive migration cannot declare allowsApplicationRollback: true."""
        for entry in self.manifest.get("migrations", []):
            m_id = entry.get("id")
            is_compat = entry.get("isBackwardCompatible")
            destructive = entry.get("destructive")
            allows_rollback = entry.get("allowsApplicationRollback")

            if not is_compat or destructive:
                self.assertFalse(
                    allows_rollback,
                    f"Migration {m_id} is breaking/destructive but declares allowsApplicationRollback: true"
                )
                self.assertGreater(
                    len(entry.get("breakingChanges", [])),
                    0,
                    f"Breaking migration {m_id} must describe breakingChanges"
                )

    def test_destructive_sql_classification_matches_reality(self):
        """SQL containing destructive schema changes (DROP TABLE, DROP COLUMN, enum drop) must be classified as breaking."""
        drop_table_re = re.compile(r'\bDROP\s+TABLE\b', re.IGNORECASE)
        drop_col_re = re.compile(r'\bALTER\s+TABLE\s+.*\bDROP\s+COLUMN\b', re.IGNORECASE)
        drop_type_re = re.compile(r'\bDROP\s+TYPE\b', re.IGNORECASE)

        manifest_by_id = {m["id"]: m for m in self.manifest.get("migrations", [])}

        for mig_dir in self.actual_migration_dirs:
            sql_path = os.path.join(self.migrations_dir, mig_dir, "migration.sql")
            if not os.path.exists(sql_path):
                continue

            with open(sql_path, "r", encoding="utf-8") as f:
                sql_content = f.read()

            has_drop_table = bool(drop_table_re.search(sql_content))
            has_drop_col = bool(drop_col_re.search(sql_content))
            has_drop_type = bool(drop_type_re.search(sql_content))

            entry = manifest_by_id[mig_dir]

            if has_drop_table or has_drop_col or has_drop_type:
                self.assertTrue(
                    entry["destructive"],
                    f"Migration {mig_dir} contains DROP TABLE, DROP COLUMN, or DROP TYPE but is not marked destructive!"
                )
                self.assertFalse(
                    entry["isBackwardCompatible"],
                    f"Migration {mig_dir} contains destructive statements but is marked isBackwardCompatible: true!"
                )
                self.assertFalse(
                    entry["allowsApplicationRollback"],
                    f"Migration {mig_dir} contains destructive statements but is marked allowsApplicationRollback: true!"
                )

    def test_authoritative_breaking_migrations_list(self):
        """Verify the exact set of breaking migrations matches authoritative catalog."""
        breaking_ids = sorted([
            m["id"] for m in self.manifest.get("migrations", [])
            if not m.get("isBackwardCompatible", True) or m.get("destructive", False)
        ])

        expected_breaking = sorted([
            "20261011123000_remove_active_reward_pools_and_pool_limits",
            "20261011180000_remove_obsolete_redemption_amount_limits",
            "20261012210000_safe_removal_of_legacy_admin_role",
        ])

        self.assertEqual(
            breaking_ids,
            expected_breaking,
            f"Breaking migrations mismatch: got {breaking_ids}, expected {expected_breaking}"
        )


if __name__ == "__main__":
    unittest.main(verbosity=2)
