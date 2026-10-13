# GitHub Environment Setup & Owner Protection Guide
**Platform:** Hiralal & Sons Sales Pvt. Ltd. — Plumber & Tile Worker Rewards Platform  
**Document Version:** 1.0 (Phase G.5 Closure)  
**Security Scope:** Production AWS EC2 Deployment and Android Release Signing Protection  

---

## 1. Executive Security Architecture

The Hiralal platform uses two isolated GitHub Environments in repository settings (`Settings -> Environments`) to enforce strict principle of least privilege, multi-party authorization, and secret isolation:

1. **`production`**: Enforces deployment gates for the AWS EC2 production stack.
2. **`android-release-signing`**: Protects the release Android Keystore and production signing passwords.

> [!IMPORTANT]
> **Declaration vs. Configuration Warning:**
> Declaring `environment: production` or `environment: android-release-signing` inside GitHub Actions workflow YAML files (`deploy-ec2.yml` and `android-release-candidate.yml`) binds the jobs to those environment names. However, **workflow YAML files cannot configure required reviewers, branch protection rules, or secret scoping on the GitHub repository settings page**.
> 
> The repository owner/administrator **must explicitly execute the manual configuration steps below** in the GitHub Web UI to prevent unauthorized or single-contributor deployments and signing.

---

## 2. Environment A: `android-release-signing`

### Purpose
Houses the Android production release keystore material and prevents any contributor from generating signed production release APKs or AABs without owner authorization and verification against `origin/main`.

### Required Environment Secrets
Navigate to **Settings -> Environments -> android-release-signing -> Environment secrets**:

| Secret Name | Description | Example / Format |
|---|---|---|
| `ANDROID_KEYSTORE_BASE64` | Base64-encoded Java Keystore (`.keystore` / `.jks`) | `base64 -w 0 release.keystore` |
| `ANDROID_KEYSTORE_PASSWORD` | Passphrase protecting the keystore file | High-entropy passphrase |
| `ANDROID_KEY_ALIAS` | Key alias inside the keystore | `hiralal-release-key` |
| `ANDROID_KEY_PASSWORD` | Passphrase protecting the specific private key | High-entropy passphrase |

> [!CAUTION]
> **Secret Hygiene Safeguards:**
> - NEVER store these secrets in Repository Secrets or Organization Secrets where ordinary CI runs could access them.
> - Scope them exclusively to `android-release-signing`.
> - Keystore material is decoded only into `$RUNNER_TEMP` during build and securely wiped (`shred -u || rm -f`) in an `always()` post-step.

### Required Environment Protection Rules
Navigate to **Settings -> Environments -> android-release-signing -> Deployment protection rules**:

1. **Required reviewers**:
   - Check **Required reviewers**.
   - Add the designated release engineer / repository owner (e.g., `abraj12` or designated security officer).
   - Require **1 or 2 approvals** before any run targeting this environment can access secrets.
2. **Deployment branches**:
   - Select **Selected branches**.
   - Add rule: `main` (strictly `refs/heads/main`).
   - Do NOT allow `*` or wildcard patterns that would permit release builds from development branches.
3. **Wait timer**:
   - Optional (e.g., 0-5 minutes) to allow cancellation if dispatched inadvertently.

---

## 3. Environment B: `production`

### Purpose
Governs live deployment to AWS EC2 Graviton2 ARM64 instances, pre-migration database backup execution, migration runner invocation, and stack startup.

### Required Environment Secrets
Navigate to **Settings -> Environments -> production -> Environment secrets**:

| Secret Name | Description | Example / Format |
|---|---|---|
| `EC2_HOST` | Production EC2 IPv4 address or hostname | `13.x.x.x` |
| `EC2_USER` | Production SSH user | `ubuntu` |
| `EC2_SSH_KEY` | Ed25519 or RSA deployment private key | OpenSSH private key PEM |
| `EC2_SSH_KNOWN_HOSTS` | Pinned server host key fingerprint line | `13.x.x.x ssh-ed25519 AAAAC3...` |

### Required Environment Protection Rules
Navigate to **Settings -> Environments -> production -> Deployment protection rules**:

1. **Required reviewers**:
   - Check **Required reviewers**.
   - Add repository owner / production infrastructure administrator.
   - Require **at least 1 explicit approval** before deployment steps can execute.
2. **Deployment branches**:
   - Select **Selected branches**.
   - Rule: `main` only.
3. **Environment variables (Optional/Non-secret)**:
   - `APP_DIR`: `/opt/hiralal`

---

## 4. Branch Protection Rules for `main`

To guarantee that only tested, reviewed, and authorized code reaches `origin/main`:

Navigate to **Settings -> Branches -> Branch protection rules -> Add rule**:

- **Branch name pattern:** `main`
- [x] **Require a pull request before merging**
  - [x] Require approvals: at least 1 approval
  - [x] Dismiss stale pull request approvals when new commits are pushed
- [x] **Require status checks to pass before merging**
  - [x] Require branches to be up to date before merging
  - Required checks to select:
    - `Validate Backend Services, Tests & Coverage`
    - `Validate Migration Runner & Schema Build`
    - `Validate Admin Frontend Build & Test`
    - `Validate Mobile App & Plugin Unit Tests`
    - `Build Android Debug APK Artifact (Expo)`
    - `Verify Multi-Architecture Docker Images (ARM64 & AMD64)`
    - `Execute Multi-Container Docker Compose Stack Smoke Test`
- [x] **Do not allow bypassing the above settings** (Enforce for administrators)
- [x] **Require linear history**
- [x] **Restrict who can push to matching branches** (Disable direct pushes)

---

## 5. Pre-Release Operator Checklist

When preparing a release candidate:

1. [ ] Confirm all feature and security pull requests are merged into `main` with 100% passing CI (`ci.yml`).
2. [ ] Identify target release commit SHA on `main` (`git rev-parse origin/main`).
3. [ ] Verify `ci.yml` run for that exact commit has status `completed` and conclusion `success`.
4. [ ] In GitHub Actions -> **Android Release Candidate Build** -> **Run workflow**:
   - Select branch: `main`
   - `release_sha`: paste full 40-character commit SHA
   - `confirm_release`: type `RELEASE`
   - `build_target`: select `both`, `aab`, or `apk`
5. [ ] Designated reviewer receives GitHub approval notification and inspects SHA before approving.
6. [ ] Workflow materializes keystore, prebuilds Expo native code, builds artifacts, verifies apksigner/jarsigner signatures, computes SHA256 checksums, and uploads artifacts.
