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


if __name__ == "__main__":
    unittest.main(verbosity=2)
