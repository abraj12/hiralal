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

if __name__ == "__main__":
    unittest.main(verbosity=2)
