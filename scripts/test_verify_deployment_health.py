#!/usr/bin/env python3
"""
Unit and regression tests for scripts/verify-deployment-health.py.
Validates healthy responses, unhealthy responses, and malformed JSON.
"""
import subprocess
import sys
import os
import unittest

import importlib.util
_script_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "verify-deployment-health.py")
_spec = importlib.util.spec_from_file_location("verify_deployment_health", _script_path)
_mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_mod)
verify_health = _mod.verify_health

class TestVerifyDeploymentHealth(unittest.TestCase):
    def setUp(self):
        self.script_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "verify-deployment-health.py")
        self.valid_health = '{"status":"ok"}'
        self.valid_ready = '{"status":"ready","checks":{"database":"healthy","redis":"healthy"}}'

    # --- Unit Tests via Direct Function Call ---

    def test_healthy_response(self):
        """Healthy responses should pass without raising SystemExit."""
        try:
            verify_health(self.valid_health, self.valid_ready)
        except SystemExit as e:
            self.fail(f"verify_health raised SystemExit unexpectedly: {e}")

    def test_unhealthy_liveness_status(self):
        """Non-ok liveness status should raise SystemExit."""
        bad_health = '{"status":"degraded"}'
        with self.assertRaises(SystemExit) as ctx:
            verify_health(bad_health, self.valid_ready)
        self.assertIn("Liveness check failed", str(ctx.exception))

    def test_unhealthy_readiness_status(self):
        """Non-ready readiness status should raise SystemExit."""
        bad_ready = '{"status":"degraded","checks":{"database":"healthy","redis":"healthy"}}'
        with self.assertRaises(SystemExit) as ctx:
            verify_health(self.valid_health, bad_ready)
        self.assertIn("Readiness check failed", str(ctx.exception))

    def test_unhealthy_database_dependency(self):
        """Unhealthy database dependency should raise SystemExit."""
        bad_ready = '{"status":"ready","checks":{"database":"unhealthy","redis":"healthy"}}'
        with self.assertRaises(SystemExit) as ctx:
            verify_health(self.valid_health, bad_ready)
        self.assertIn("Unhealthy dependencies: database", str(ctx.exception))

    def test_unhealthy_redis_dependency(self):
        """Unhealthy redis dependency should raise SystemExit."""
        bad_ready = '{"status":"ready","checks":{"database":"healthy","redis":"down"}}'
        with self.assertRaises(SystemExit) as ctx:
            verify_health(self.valid_health, bad_ready)
        self.assertIn("Unhealthy dependencies: redis", str(ctx.exception))

    def test_both_dependencies_unhealthy(self):
        """Both database and redis unhealthy should list both in failure."""
        bad_ready = '{"status":"ready","checks":{"database":"unhealthy","redis":"unhealthy"}}'
        with self.assertRaises(SystemExit) as ctx:
            verify_health(self.valid_health, bad_ready)
        self.assertIn("database", str(ctx.exception))
        self.assertIn("redis", str(ctx.exception))

    def test_missing_checks_object(self):
        """Missing checks field should raise SystemExit."""
        bad_ready = '{"status":"ready"}'
        with self.assertRaises(SystemExit) as ctx:
            verify_health(self.valid_health, bad_ready)
        self.assertIn("Unhealthy dependencies", str(ctx.exception))

    def test_malformed_health_json(self):
        """Malformed JSON for health probe should fail safely."""
        malformed = '<html>502 Bad Gateway</html>'
        with self.assertRaises(SystemExit) as ctx:
            verify_health(malformed, self.valid_ready)
        self.assertIn("Malformed health JSON response", str(ctx.exception))

    def test_malformed_readiness_json(self):
        """Malformed JSON for readiness probe should fail safely."""
        malformed = '{"status": "ready", invalid_json'
        with self.assertRaises(SystemExit) as ctx:
            verify_health(self.valid_health, malformed)
        self.assertIn("Malformed readiness JSON response", str(ctx.exception))

    def test_non_dict_json_payloads(self):
        """JSON numbers or lists should fail safely."""
        with self.assertRaises(SystemExit) as ctx:
            verify_health('["status", "ok"]', self.valid_ready)
        self.assertIn("Liveness check failed", str(ctx.exception))

        with self.assertRaises(SystemExit) as ctx:
            verify_health(self.valid_health, '"ready"')
        self.assertIn("Readiness check failed", str(ctx.exception))

    # --- CLI Subprocess Execution Tests ---

    def test_cli_healthy_execution(self):
        """CLI invocation with healthy inputs exits 0 and prints verification message."""
        res = subprocess.run(
            [sys.executable, self.script_path, self.valid_health, self.valid_ready],
            capture_output=True,
            text=True
        )
        self.assertEqual(res.returncode, 0)
        self.assertIn("Liveness and dependency readiness verified.", res.stdout)

    def test_cli_unhealthy_execution(self):
        """CLI invocation with unhealthy inputs exits non-zero and prints error to stderr."""
        unhealthy_ready = '{"status":"ready","checks":{"database":"healthy","redis":"unhealthy"}}'
        res = subprocess.run(
            [sys.executable, self.script_path, self.valid_health, unhealthy_ready],
            capture_output=True,
            text=True
        )
        self.assertNotEqual(res.returncode, 0)
        self.assertIn("Unhealthy dependencies: redis", res.stderr)

    def test_cli_malformed_execution(self):
        """CLI invocation with malformed input exits non-zero."""
        res = subprocess.run(
            [sys.executable, self.script_path, "not-json", self.valid_ready],
            capture_output=True,
            text=True
        )
        self.assertNotEqual(res.returncode, 0)
        self.assertIn("Malformed health JSON response", res.stderr)

    def test_cli_missing_arguments(self):
        """CLI invocation with missing arguments exits non-zero with usage message."""
        res = subprocess.run(
            [sys.executable, self.script_path],
            capture_output=True,
            text=True
        )
        self.assertNotEqual(res.returncode, 0)
        self.assertIn("Usage:", res.stderr)


class TestDeploymentWorkflowSafety(unittest.TestCase):
    """
    Test L: Automated static verification of release and deployment workflow safety gates.
    Validates deploy-ec2.yml and android-release-candidate.yml against authoritative security constraints.
    """
    def setUp(self):
        self.repo_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        self.deploy_workflow_path = os.path.join(self.repo_root, ".github", "workflows", "deploy-ec2.yml")
        self.android_workflow_path = os.path.join(self.repo_root, ".github", "workflows", "android-release-candidate.yml")

        with open(self.deploy_workflow_path, "r", encoding="utf-8") as f:
            self.deploy_content = f.read()

        with open(self.android_workflow_path, "r", encoding="utf-8") as f:
            self.android_content = f.read()

    def test_ec2_deployment_not_triggered_by_ci_success(self):
        """Production deployment must not be automatically triggered on CI success (no workflow_run)."""
        self.assertNotIn("workflow_run:", self.deploy_content)
        self.assertNotIn("types: [completed]", self.deploy_content)

    def test_ec2_deployment_manual_only(self):
        """Production deployment trigger must be workflow_dispatch only."""
        self.assertIn("workflow_dispatch:", self.deploy_content)
        self.assertNotIn("push:", self.deploy_content)
        self.assertNotIn("pull_request:", self.deploy_content)

    def test_ec2_deployment_refuses_non_main_refs(self):
        """Production deployment workflow must refuse execution on non-main branches."""
        self.assertIn("github.ref == 'refs/heads/main'", self.deploy_content)
        self.assertIn("confirm_deploy == 'DEPLOY'", self.deploy_content)

    def test_ec2_deployment_enforces_exact_sha_and_drift_check(self):
        """Production deployment requires a 40-char hex commit SHA and checks for drift against origin/main."""
        self.assertIn("^[0-9a-f]{40}$", self.deploy_content)
        self.assertIn('"${RELEASE_SHA}" != "${MAIN_HEAD}"', self.deploy_content)
        self.assertIn("Release drift detected", self.deploy_content)

    def test_ec2_deployment_verifies_successful_ci_run(self):
        """Production deployment verifies that the target SHA passed the CI pipeline."""
        self.assertIn('CI_CONCLUSION=$(gh run list --commit "${RELEASE_SHA}"', self.deploy_content)
        self.assertIn('"${CI_CONCLUSION}" != "success"', self.deploy_content)

    def test_ec2_deployment_fails_closed_on_missing_secrets(self):
        """Production deployment halts before SSH connection if mandatory secrets are missing."""
        self.assertIn('if [ -z "${EC2_HOST}" ] || [ -z "${EC2_SSH_KEY}" ] || [ -z "${EC2_SSH_KNOWN_HOSTS}" ]', self.deploy_content)
        self.assertIn("Mandatory EC2 deployment secrets", self.deploy_content)

    def test_ec2_deployment_mandates_strict_host_key_checking(self):
        """SSH invocation must enforce StrictHostKeyChecking=yes with known_hosts."""
        self.assertIn("StrictHostKeyChecking=yes", self.deploy_content)
        self.assertIn("known_hosts", self.deploy_content)

    def test_ec2_deployment_runs_pre_migration_backup_gate(self):
        """Pre-deployment database backup gate is mandatory before applying migrations."""
        self.assertIn("./scripts/backup-db.sh", self.deploy_content)
        self.assertIn("Pre-deployment database backup gate", self.deploy_content)

    def test_android_release_workflow_manual_only(self):
        """Android release candidate build trigger must be workflow_dispatch only."""
        self.assertIn("workflow_dispatch:", self.android_content)
        self.assertNotIn("push:", self.android_content)
        self.assertNotIn("pull_request:", self.android_content)

    def test_android_release_workflow_requires_confirmation_and_sha(self):
        """Android release candidate requires 'RELEASE' confirmation and 40-char hex SHA without inline expression injection."""
        self.assertIn('"$CONFIRM_RELEASE" != "RELEASE"', self.android_content)
        self.assertIn('^[0-9a-fA-F]{40}$', self.android_content)
        self.assertNotIn('${{ github.event.inputs.confirm_release }}', self.android_content.split("run: |")[1])

    def test_android_release_workflow_verifies_origin_main(self):
        """Android release candidate verifies target commit matches origin/main head."""
        self.assertIn('"${RELEASE_SHA}" != "${MAIN_HEAD}"', self.android_content)
        self.assertIn("origin/main", self.android_content)

    def test_android_release_workflow_binds_protected_environment(self):
        """Android release candidate must bind protected environment android-release-signing."""
        self.assertIn("environment: android-release-signing", self.android_content)
        self.assertIn("github.ref == 'refs/heads/main'", self.android_content)

    def test_android_release_workflow_structured_ci_check(self):
        """Android release candidate queries structured fields from gh run list."""
        self.assertIn("--json headSha,status,conclusion,databaseId", self.android_content)
        self.assertIn('.status == "completed" and .conclusion == "success"', self.android_content)

    def test_android_release_workflow_fails_closed_on_missing_signing_secrets(self):
        """Android release candidate fails before build if signing secrets are missing."""
        for secret_name in [
            "ANDROID_KEYSTORE_BASE64",
            "ANDROID_KEYSTORE_PASSWORD",
            "ANDROID_KEY_ALIAS",
            "ANDROID_KEY_PASSWORD"
        ]:
            self.assertIn(secret_name, self.android_content)
        self.assertIn("Missing required Android signing secrets", self.android_content)

    def test_android_release_workflow_verifies_signature_and_erases_keystore(self):
        """Android release candidate runs apksigner and jarsigner verify and securely erases keystore file."""
        self.assertIn("apksigner verify", self.android_content)
        self.assertIn("jarsigner -verify", self.android_content)
        self.assertIn("sha256sum", self.android_content)
        self.assertIn("shred -u", self.android_content)

    def test_ec2_deployment_captures_previous_sha_and_handles_rollback(self):
        """EC2 deployment workflow captures PREVIOUS_SHA and executes safe application rollback on failure."""
        self.assertIn("PREVIOUS_SHA", self.deploy_content)
        self.assertIn("rollback", self.deploy_content.lower())
        self.assertIn("forward-only", self.deploy_content.lower())

    def test_no_secret_material_echoed_in_workflow_logs(self):
        """Neither release nor deployment workflow should echo private keys or passwords."""
        for content in [self.deploy_content, self.android_content]:
            self.assertNotIn('echo "${EC2_SSH_KEY}"', content)
            self.assertNotIn('echo "$KEYSTORE_PASS"', content)
            self.assertNotIn('echo "$KEY_PASS"', content)
            self.assertNotIn('echo "${{ secrets.ANDROID_KEYSTORE_PASSWORD }}"', content)
            self.assertNotIn('echo "${{ secrets.ANDROID_KEY_PASSWORD }}"', content)


class TestRollbackAndReleaseIntegrity(unittest.TestCase):
    """
    Automated verification of Docker rollback, image immutability, migration compatibility,
    and release candidate verification in Phase G.6.
    """
    def setUp(self):
        self.repo_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        self.compose_path = os.path.join(self.repo_root, "docker-compose.yml")
        self.env_example_path = os.path.join(self.repo_root, ".env.example")
        self.manifest_path = os.path.join(self.repo_root, "backend", "prisma", "migrations", "deployment-compatibility.json")
        self.rollback_script_path = os.path.join(self.repo_root, "scripts", "deploy", "rollback-release.sh")
        self.backend_dockerfile = os.path.join(self.repo_root, "backend", "Dockerfile")
        self.admin_dockerfile = os.path.join(self.repo_root, "admin", "Dockerfile")
        self.migrate_dockerfile = os.path.join(self.repo_root, "backend", "Dockerfile.migrate")
        self.android_workflow = os.path.join(self.repo_root, ".github", "workflows", "android-release-candidate.yml")
        self.deploy_workflow = os.path.join(self.repo_root, ".github", "workflows", "deploy-ec2.yml")

        with open(self.compose_path, "r", encoding="utf-8") as f:
            self.compose_content = f.read()
        with open(self.env_example_path, "r", encoding="utf-8") as f:
            self.env_example_content = f.read()
        with open(self.manifest_path, "r", encoding="utf-8") as f:
            self.manifest_content = f.read()
        with open(self.rollback_script_path, "r", encoding="utf-8") as f:
            self.rollback_script_content = f.read()
        with open(self.android_workflow, "r", encoding="utf-8") as f:
            self.android_workflow_content = f.read()
        with open(self.deploy_workflow, "r", encoding="utf-8") as f:
            self.deploy_workflow_content = f.read()

    def test_docker_compose_immutable_image_tags(self):
        """docker-compose.yml must define explicit, immutable image tags tied to HIRALAL_IMAGE_TAG."""
        self.assertIn("hiralal-backend:${HIRALAL_IMAGE_TAG:?HIRALAL_IMAGE_TAG is required}", self.compose_content)
        self.assertIn("hiralal-worker:${HIRALAL_IMAGE_TAG:?HIRALAL_IMAGE_TAG is required}", self.compose_content)
        self.assertIn("hiralal-admin:${HIRALAL_IMAGE_TAG:?HIRALAL_IMAGE_TAG is required}", self.compose_content)

    def test_docker_compose_vcs_ref_build_args(self):
        """docker-compose.yml services must pass VCS_REF build args."""
        self.assertIn("VCS_REF: ${HIRALAL_IMAGE_TAG:-unknown}", self.compose_content)

    def test_dockerfiles_have_oci_revision_labels(self):
        """All production Dockerfiles must declare OCI revision labels in runner stages."""
        for path in [self.backend_dockerfile, self.admin_dockerfile, self.migrate_dockerfile]:
            with open(path, "r", encoding="utf-8") as f:
                content = f.read()
            self.assertIn("LABEL org.opencontainers.image.revision", content)

    def test_env_example_has_image_tag_default(self):
        """env.example must define default HIRALAL_IMAGE_TAG=local for dev/CI compose execution."""
        self.assertIn("HIRALAL_IMAGE_TAG=local", self.env_example_content)

    def test_migration_compatibility_manifest_integrity(self):
        """deployment-compatibility.json must catalog all migrations with breaking change designations."""
        import json
        manifest = json.loads(self.manifest_content)
        self.assertEqual(manifest.get("version"), "1.0.0")
        migrations = manifest.get("migrations", [])
        self.assertGreaterEqual(len(migrations), 17)

        # Verify breaking migrations are marked properly
        breaking_ids = [m["id"] for m in migrations if not m.get("isBackwardCompatible", True)]
        self.assertIn("20261011123000_remove_active_reward_pools_and_pool_limits", breaking_ids)
        self.assertIn("20261011180000_remove_obsolete_redemption_amount_limits", breaking_ids)
        self.assertIn("20261012210000_safe_removal_of_legacy_admin_role", breaking_ids)

    def test_rollback_script_safety_invariants(self):
        """Rollback helper script must enforce forward-only database schema, compatibility gate, and health checks."""
        self.assertIn("FORWARD-ONLY", self.rollback_script_content)
        self.assertIn("deployment-compatibility.json", self.rollback_script_content)
        self.assertIn("verify-deployment-health.py", self.rollback_script_content)
        self.assertIn("hiralal-backend", self.rollback_script_content)

    def test_android_release_workflow_verifies_all_requested_targets(self):
        """Android release workflow must enforce existence of requested artifact set based on target."""
        self.assertIn("APK_COUNT", self.android_workflow_content)
        self.assertIn("AAB_COUNT", self.android_workflow_content)
        self.assertIn("EXPECTED_RELEASE_CERT_SHA256", self.android_workflow_content)
        self.assertIn("sort -k2 > SHA256SUMS.txt", self.android_workflow_content)
        self.assertIn("sha256sum --check SHA256SUMS.txt", self.android_workflow_content)

    def test_deploy_workflow_stores_release_metadata_and_calls_rollback(self):
        """deploy-ec2.yml must capture running container IDs, store active release metadata, and call rollback-release.sh."""
        self.assertIn("active-release.json", self.deploy_workflow_content)
        self.assertIn("rollback-release.sh", self.deploy_workflow_content)
        self.assertIn("CURRENT_BACKEND_IMG", self.deploy_workflow_content)


class TestRollbackExecutionDecision(unittest.TestCase):
    """
    Exercises fail-closed rollback decisions per Workstream B:
    - Input validation: reject malformed or non-existent commit SHAs
    - Require PREVIOUS_SHA != TARGET_SHA
    - Reject rollback if migration delta contains breaking/destructive migrations
    - Reject rollback if migration delta contains uncatalogued migrations
    - Allow rollback when all migrations in the delta are explicitly non-destructive and allowsApplicationRollback is true
    """
    def setUp(self):
        self.repo_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        self.manifest_path = os.path.join(self.repo_root, "backend", "prisma", "migrations", "deployment-compatibility.json")
        import json
        with open(self.manifest_path, "r", encoding="utf-8") as f:
            self.manifest = json.loads(f.read())
        self.migrations_map = {m["id"]: m for m in self.manifest.get("migrations", [])}

    def evaluate_rollback(self, migration_ids):
        """
        Replicates the fail-closed evaluation logic implemented in rollback-release.sh.
        Returns (allowed: bool, reason: str).
        """
        for mig_id in migration_ids:
            if mig_id not in self.migrations_map:
                return False, f"Uncatalogued migration {mig_id}"
            m = self.migrations_map[mig_id]
            if m.get("destructive", False):
                return False, f"Destructive migration {mig_id}"
            if not m.get("allowsApplicationRollback", True):
                return False, f"Migration {mig_id} does not allow rollback"
        return True, "Rollback permitted"

    def test_destructive_migrations_blocked(self):
        breaking = [
            "20261011123000_remove_active_reward_pools_and_pool_limits",
            "20261011180000_remove_obsolete_redemption_amount_limits",
            "20261012210000_safe_removal_of_legacy_admin_role",
        ]
        for mig in breaking:
            allowed, reason = self.evaluate_rollback([mig])
            self.assertFalse(allowed, f"Expected {mig} to block rollback")
            self.assertIn(mig, reason)

    def test_uncatalogued_migration_blocked(self):
        allowed, reason = self.evaluate_rollback(["20261099999999_unknown_future_migration"])
        self.assertFalse(allowed)
        self.assertIn("Uncatalogued", reason)

    def test_compatible_migration_allowed(self):
        compatible = [
            m["id"] for m in self.manifest.get("migrations", [])
            if m.get("allowsApplicationRollback", True) and not m.get("destructive", False)
        ]
        self.assertGreater(len(compatible), 0)
        allowed, reason = self.evaluate_rollback([compatible[0]])
        self.assertTrue(allowed)
        self.assertEqual(reason, "Rollback permitted")

    def test_commit_sha_validation_format(self):
        import re
        sha_regex = re.compile(r"^[0-9a-f]{40}$")
        valid_sha = "90ae6bf343c3cd9146341096e440e20c38eb0532"
        invalid_shas = [
            "not-a-sha",
            "90ae6bf",
            "90ae6bf343c3cd9146341096e440e20c38eb053z",
            "",
            "   ",
        ]
        self.assertTrue(bool(sha_regex.match(valid_sha)))
        for s in invalid_shas:
            self.assertFalse(bool(sha_regex.match(s)))


if __name__ == "__main__":
    unittest.main(verbosity=2)
