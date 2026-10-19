# Production Deployment & Third-Party Integration Guide

## Hiralal and Sons Sales Pvt. Ltd. — Rewards Management System
**Production Domain:** `https://hsspl.algions.in`

---

### 1. Cloudflare R2 Private Document Storage

1. Create a Cloudflare account and create a private R2 bucket named `hiralal-invoices-private`.
2. Generate an R2 API Token with **Object Read & Write** permissions scoped to the bucket.
3. Configure the environment variables using the active application variable names:
   ```env
   R2_ACCOUNT_ID="<your_cloudflare_account_id>"
   R2_ACCESS_KEY_ID="<your_r2_access_key_id>"
   R2_SECRET_ACCESS_KEY="<your_r2_secret_access_key>"
   R2_BUCKET_NAME="hiralal-invoices-private"
   R2_ENDPOINT="https://<your_cloudflare_account_id>.r2.cloudflarestorage.com"
   STORAGE_HMAC_SECRET="<generate_64_hex_character_hmac_secret>"
   ```
4. **Security Notice**: Do NOT make the bucket public. The backend generates time-limited S3 pre-signed URLs (or HMAC signed URLs in local development) with an 1800-second (30-minute) TTL (`GET /api/admin/bills/:id/document-url`).

---

### 2. RazorpayX Payouts & Webhooks Setup

1. Open your RazorpayX dashboard and obtain your corporate API credentials:
   ```env
   RAZORPAYX_KEY_ID="rzp_live_<key_id>"
   RAZORPAYX_KEY_SECRET="<key_secret>"
   RAZORPAYX_ACCOUNT_NUMBER="<hiralal_current_account_number>"
   RAZORPAYX_WEBHOOK_SECRET="<generate_strong_webhook_secret>"
   ```
2. Configure Webhook in RazorpayX Dashboard:
   - **URL**: `https://hsspl.algions.in/api/v1/webhooks/razorpayx` (or `https://hsspl.algions.in/api/v1/payouts/webhook` compatibility alias)
   - **Secret**: Must match `RAZORPAYX_WEBHOOK_SECRET`
   - **Subscribed Events**:
     - `payout.processed` (triggers transition to `SUCCESS` in wallet ledger)
     - `payout.reversed` (triggers fund refund and `PAYOUT_REVERSAL` in wallet ledger)
     - `payout.failed` (triggers fund refund to craftsman wallet)

---

### 3. WhatsApp Business Platform Cloud API (Phone Verification OTP)

Configure the official Meta WhatsApp Business Cloud API for phone-verification OTPs:
```env
OTP_PROVIDER="WHATSAPP"
WHATSAPP_API_URL="https://graph.facebook.com"
WHATSAPP_API_VERSION="v21.0"
WHATSAPP_PHONE_NUMBER_ID="<your_meta_phone_number_id>"
WHATSAPP_ACCESS_TOKEN="<your_permanent_system_user_access_token>"
WHATSAPP_BUSINESS_ACCOUNT_ID="<your_waba_account_id>"
WHATSAPP_TEMPLATE_NAME="hiralal_auth_otp"
WHATSAPP_TEMPLATE_LANGUAGE="en_US"
WHATSAPP_AUTH_BUTTON_TYPE="COPY_CODE"
```

#### Approved Authentication Template Details:
- **Category:** `AUTHENTICATION`
- **Template Name:** `hiralal_auth_otp`
- **Languages:** `en_US`, `hi`
- **Body:** `{{1}} is your verification code for Hiralal & Sons Rewards Platform. For security reasons, do not share this code with anyone. Valid for 5 minutes.`
- **Buttons:** One-tap `COPY_CODE` button (`Copy Code`).
- **Security Invariant:** OTP codes are generated via `crypto.randomInt()`, hashed with server HMAC-SHA256, single-use invalidated, rate-limited to 60-second cooldown, and access tokens are strictly redacted from logs.

---

### 4. PAN Tax Verification Provider (SignCare)

Configure SignCare for instant PAN verification and authoritative tax name matching:
```env
SIGNCARE_BASE_URL="https://api.signcare.in"
SIGNCARE_API_KEY="<your_signcare_api_key>"
SIGNCARE_APP_ID="<your_signcare_app_id>"
```

*Note: In production, `SIGNCARE_BASE_URL` is mandatory, must use HTTPS, and strictly rejects localhost, loopback, and UAT/sandbox URLs (fails closed).*

---

### 5. Firebase Cloud Messaging (FCM HTTP v1) Push Notifications

Configure Google Service Account credentials for push delivery via Mode A (triplet) or Mode B (service account JSON):
```env
# Mode A: Triplet
FIREBASE_PROJECT_ID="<your_firebase_project_id>"
FIREBASE_CLIENT_EMAIL="<service_account_client_email>"
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"

# Mode B: Service Account JSON file path or string
# FIREBASE_SERVICE_ACCOUNT_KEY="/etc/hiralal/firebase-service-account.json"
```

---

### 6. Production Docker Deployment & Health Validation

Deploy the full stack on Hostinger KVM 2 VPS (Ubuntu x86_64):
```bash
docker compose up -d --build
```

Execute database migration using dedicated migration runner container:
```bash
docker compose --profile tools build migrate
docker compose --profile tools run --rm migrate
docker compose exec backend npm run seed
```

Validate deployment health using the Python verification script:
```bash
python3 scripts/verify-deployment-health.py '{"status":"ok"}' '{"status":"ready","checks":{"database":"healthy","redis":"healthy"}}'
```

---

### 7. GitHub Actions Production Deployment & Release Workflows

#### Production Hostinger KVM 2 Deployment (`.github/workflows/deploy-kvm.yml`)
- **Target Server**: Hostinger KVM 2 VPS (2 vCPU, 8 GB RAM, Ubuntu x86_64).
- **Environment**: Bound to canonical GitHub Environment `production-kvm`.
- **Trigger**: Manual only (`workflow_dispatch`).
- **Required Inputs**:
  - `confirm_deploy`: Must equal `DEPLOY` exactly.
  - `release_sha`: Exact 40-character hexadecimal Git commit SHA on `origin/main`.
- **Pre-deployment Safety Gates**:
  - Target commit must be on `origin/main` without drift (`RELEASE_SHA == MAIN_HEAD`).
  - Target commit must have a completed, successful CI run (`ci.yml`).
  - Mandatory secrets (`KVM_HOST`, `KVM_SSH_KEY`, `KVM_SSH_KNOWN_HOSTS`) fail closed before SSH.
  - Pre-migration database backup (`scripts/backup-db.sh`) is mandatory.
  - Health check failure triggers automated forward-only container rollback (`rollback-release.sh`).

#### Signed Android Release Candidate (`.github/workflows/android-release-candidate.yml`)
- **Trigger**: Manual only (`workflow_dispatch`).
- **Required Inputs**:
  - `release_sha`: Exact 40-character Git commit SHA on `origin/main`.
  - `confirm_release`: Must equal `RELEASE` exactly.
  - `build_target`: `both`, `aab`, or `apk`.
- **Signing Secrets**: `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`.
- **Output**: Verified signed `.aab` / `.apk`, `apksigner verify` signature summary, and `SHA256SUMS.txt`. Keystore material is securely erased after build.

---

### 8. Repository Security & GitHub Branch Protection Ruleset

To protect production stability and ensure all financial and security controls remain uncompromised:

1. **Target Branch**: Configure Branch Protection Ruleset on `main`.
2. **Require Pull Request Reviews**:
   - Minimum 1 approved review from senior repository maintainer.
   - Dismiss stale approvals when new commits are pushed.
   - Require review from Code Owners if applicable.
3. **Require Status Checks to Pass Before Merging**:
   - Require branches to be up to date before merging.
   - Mandatory checks: `ci / test`, `ci / lint-and-typecheck`.
4. **Prevent Direct Pushes & Force Pushes**:
   - Block `git push --force` completely.
   - Block branch deletion.
5. **Linear Commit History**:
   - Require linear history (Squash and merge or rebase).

