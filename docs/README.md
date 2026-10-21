# Documentation Index & Developer Portal
## Hiralal and Sons Sales Pvt. Ltd. — Plumber & Tile Worker Rewards Platform

Welcome to the complete documentation index for the Hiralal & Sons rewards and incentive management platform. All documents listed below are actively maintained and synchronized with the codebase.

---

### 1. Getting Started & Architecture
- [**Root Overview & Quick Start**](../README.md): High-level system architecture, service topology, memory budgets, and local development setup.
- [**System Architecture & Technical Design**](ARCHITECTURE.md): Multi-tier application architecture, single-company scope, dynamic theme engine, financial ledger model, and payout state machine.
- [**Environment Variables Inventory**](ENVIRONMENT_VARIABLES.md): Comprehensive inventory of all production and development environment variables, cryptographic keys, and service configurations.

### 2. Backend & API Services
- [**REST API Documentation**](API_DOCUMENTATION.md): Complete specification of craftsman authentication, bill submission, admin verification endpoints, and RazorpayX webhook interfaces.
- [**Environment Variables Inventory**](ENVIRONMENT_VARIABLES.md): Detailed reference of all backend and worker configuration flags.

### 3. Security, KYC & Identity Verification
- [**Security Architecture & Policies**](SECURITY.md): Exact PAN-to-bank account name matching rules, cryptographic controls (AES-256-GCM, HMAC blind indexing), 3-tier admin authentication, role boundaries, and mobile attestation.
- [**GitHub Secrets & CI/CD Setup**](security/GITHUB_ENVIRONMENT_SETUP.md): Guidance for configuring CI/CD repository secrets and environments.

### 4. Testing, Quality Assurance & Verification
- [**Testing & Verification Guide**](TESTING.md): Test commands, package-specific test suites (Backend, Admin, Mobile, Mobile-Admin), mock implementations, and execution evidence for all 816 passing tests.

### 5. Deployment, Operations & Disaster Recovery
- [**Production Deployment Guide (Runbook)**](DEPLOYMENT.md): Step-by-step instructions for Hostinger KVM 2 VPS deployment using Docker Compose, Nginx SSL termination, and UFW firewall hardening.
- [**Third-Party Integrations Setup Guide**](DEPLOYMENT_GUIDE.md): Setup procedures for Cloudflare R2, RazorpayX corporate banking, Meta WhatsApp Cloud API, and SignCare.
- [**Root Deployment Reference**](../DEPLOYMENT.md): Hostinger VPS provisioning instructions, sysctl kernel configurations, and fail2ban setup.
- [**Systemd Service Configurations**](../deploy/systemd/README.md): Native Linux systemd service unit definitions for bare-metal or VM process management.

### 6. Bug Registers & Remediation Tracking
- [**Master Bug & Vulnerability Register**](MASTER_BUG_REGISTER.md): Authoritative ledger of all findings across all audits (`NAME-MATCH-01`, `VERIF-01` to `VERIF-17`, `FIN-BUG-01` to `FIN-BUG-03`, `SEC-KYC-01`, etc.) with root causes and verified statuses.
- [**Remediation History & Engineering Log**](REMEDIATION_HISTORY.md): Chronological record of completed remediations, implementation approaches, affected files, and verification results.

### 7. Release Notes & Historical Audits
- [**Changelog**](../CHANGELOG.md): Versioned record of security fixes, database changes, and functional enhancements.
- **Historical Audit Reports** *(Preserved baseline reports for specific commits)*:
  - [Master Remediation Completion Report](audits/master-remediation-completion-report.md)
  - [Master Remediation Requirements Compliance Report](audits/master_remediation_requirements_compliance_report.md)
  - [Part 2 Master Remediation Report](audits/part_2_master_remediation_report.md)
  - [Part 2 Play Integrity Hardening Report](audits/part_2_play_integrity_hardening_report.md)
  - [Part 2a5 Audit Remediation Report](audits/part_2a5_audit_remediation_report.md)
  - [Phase G3 Implementation Closure Report](audits/phase_g3_implementation_closure_report.md)
  - [Phase G5 Remediation Report](audits/phase_g5_remediation_report.md)
  - [Phase G6 Remediation Report](audits/phase_g6_remediation_report.md)
  - [Phase G7 Remediation Report](audits/phase_g7_remediation_report.md)
  - [V3 Security & Release Closure Report](audits/v3_security_and_release_closure_report.md)
  - [V4 Remediation & Security Closure Report](audits/v4_remediation_and_security_closure_report.md)
