#!/usr/bin/env python3
"""
Authoritative JSON validation for application liveness and dependency readiness.
Used during deployment gates to verify post-deployment service health on Hostinger KVM 2 VPS.
"""
import json
import sys

def verify_health(health_raw: str, ready_raw: str) -> None:
    try:
        health = json.loads(health_raw)
    except Exception as e:
        raise SystemExit(f"Malformed health JSON response: {e}")

    try:
        ready = json.loads(ready_raw)
    except Exception as e:
        raise SystemExit(f"Malformed readiness JSON response: {e}")

    if not isinstance(health, dict) or health.get("status") != "ok":
        status = health.get("status") if isinstance(health, dict) else health
        raise SystemExit(f"Liveness check failed: status is '{status}' (expected 'ok')")

    if not isinstance(ready, dict) or ready.get("status") != "ready":
        status = ready.get("status") if isinstance(ready, dict) else ready
        raise SystemExit(f"Readiness check failed: status is '{status}' (expected 'ready')")

    checks = ready.get("checks", {})
    if not isinstance(checks, dict):
        raise SystemExit("Readiness check failed: missing or invalid 'checks' object")

    required = ("database", "redis")
    failed = [key for key in required if checks.get(key) != "healthy"]

    if failed:
        raise SystemExit("Unhealthy dependencies: " + ", ".join(failed))

    print("Liveness and dependency readiness verified.")

def main():
    if len(sys.argv) < 3:
        raise SystemExit("Usage: verify-deployment-health.py <health_json> <ready_json>")
    verify_health(sys.argv[1], sys.argv[2])

if __name__ == "__main__":
    main()
