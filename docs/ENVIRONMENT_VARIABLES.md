# Production Environment Variables Inventory
## Hiralal and Sons Sales Pvt. Ltd. — Platform Configuration

This document provides a comprehensive inventory of all environment variables used across the backend, worker daemon, admin portal, and deployment scripts.

> **CRITICAL SECURITY NOTICE:**  
> Never commit live production secrets, tokens, or encryption keys to version control. Use `.env.production.example` as a template and inject secrets at runtime via secure environment managers or files with `chmod 600` permissions.

---

## 1. Core Infrastructure & Databases

| Variable | Required | Default / Format | Description & Scope |
|---|---|---|---|
| `NODE_ENV` | Yes | `production` / `development` | Node.js execution environment. Controls verbose logging, security headers, and strict error sanitization. |
| `PORT` | No | `5000` | HTTP port on which the Express REST API listens. |
| `DATABASE_URL` | Yes | `postgresql://user:pass@host:5432/db?schema=public` | Authoritative PostgreSQL connection string used by Prisma ORM. |
| `POSTGRES_USER` | Yes (Docker) | String (e.g. `postgres`) | Database superuser name for PostgreSQL container initialization. |
| `POSTGRES_PASSWORD` | Yes (Docker) | Min 32 chars | High-entropy password for PostgreSQL database. |
| `POSTGRES_DB` | Yes (Docker) | `hiralal_rewards` | Database name created during initial container boot. |
| `REDIS_HOST` | No | `redis` or `localhost` | Hostname of the Redis 7 in-memory cache and queue server. |
| `REDIS_PORT` | No | `6379` | Port for Redis connection. |
| `REDIS_PASSWORD` | Yes (Prod) | String | High-entropy authentication password for Redis. |

---

## 2. Cryptography & Security Keys

| Variable | Required | Expected Format | Purpose & Implementation |
|---|---|---|---|
| `JWT_ACCESS_SECRET` | Yes | 64-character hex (`openssl rand -hex 32`) | Secret key used to sign and verify craftsman JWT access tokens (HS256). |
| `JWT_REFRESH_SECRET` | Yes | 64-character hex | Secret key used to sign long-lived refresh tokens. |
| `ADMIN_ACCESS_SECRET` / `JWT_ADMIN_ACCESS_SECRET` | Yes | 64-character hex | Distinct dedicated secret key used exclusively for administrative access tokens. |
| `ENCRYPTION_KEY` | Yes | 64-character hex (32 bytes) | Primary symmetric key used for AES-256-GCM application-level payload encryption. |
| `FIELD_ENCRYPTION_KEY` | Yes | 64-character hex (32 bytes) | Dedicated symmetric key for database field encryption (e.g., PAN, bank account numbers). |
| `PREVIOUS_FIELD_ENCRYPTION_KEYS` | Optional | Comma-separated 64-char hex keys | Previous encryption keys used for seamless zero-downtime key rotation of encrypted database fields. |
| `BLIND_INDEX_SECRET` | Yes | 64-character hex | Pepper used with HMAC-SHA256 to compute deterministic searchable blind indexes. |
| `STORAGE_HMAC_SECRET` | Yes | 64-character hex | Secret key used for signing document access tokens and private presigned URLs. |
| `OTP_HMAC_SECRET` | Yes | 64-character hex | HMAC key used to generate cryptographic challenge tokens during 2FA OTP verification. |
| `BACKUP_ENCRYPTION_PASSPHRASE` | Yes | High-entropy passphrase | Used by `backup-db.sh` and `restore-db.sh` to encrypt/decrypt database dumps via AES-256-GCM. |

---

## 3. Administrative Access & Bootstrapping

| Variable | Required | Expected Format | Purpose & Implementation |
|---|---|---|---|
| `BILL_ADMIN_PREFIX` | Yes | High-entropy random string, 16+ characters | Server-side Tier-1 credential for `BILL_ADMIN`; never expose it through `NEXT_PUBLIC_*` or client bundles. |
| `OPERATIONS_ADMIN_PREFIX` | Yes | High-entropy random string, 16+ characters | Server-side Tier-1 credential for `OPERATIONS_ADMIN`; never expose it through `NEXT_PUBLIC_*` or client bundles. |
| `BILL_ADMIN_MOBILE` | Yes | 10-digit Indian Mobile | Mobile number used for bootstrapping the initial `BILL_ADMIN` account. |
| `OPERATIONS_ADMIN_MOBILE` | Yes | 10-digit Indian Mobile | Mobile number used for bootstrapping the initial `OPERATIONS_ADMIN` account. |
| `BILL_ADMIN_INITIAL_PASSWORD` | Yes | Strong Password | Temporary seed password for `BILL_ADMIN`. Must be changed on first login. |
| `OPERATIONS_ADMIN_INITIAL_PASSWORD` | Yes | Strong Password | Temporary seed password for `OPERATIONS_ADMIN`. Must be changed on first login. |
| `ADMIN_ACCESS_TOKEN_EXPIRES_IN` | No | `1d` | Expiration lifetime for administrative session tokens. |

---

## 4. WhatsApp Business Platform & OTP Gateway

| Variable | Required | Expected Format | Purpose & Implementation |
|---|---|---|---|
| `OTP_PROVIDER` | Yes | `WHATSAPP` (or `MSG91`) | Primary one-time passcode transport gateway. |
| `WHATSAPP_API_URL` | Yes | `https://graph.facebook.com` | Meta Graph API endpoint. |
| `WHATSAPP_API_VERSION` | Yes | `v21.0` | Meta Graph API version. |
| `WHATSAPP_PHONE_NUMBER_ID` | Yes | Numeric ID | Meta Cloud API registered phone number ID. |
| `WHATSAPP_ACCESS_TOKEN` | Yes | Token (`EAAB...`) | Permanent Meta System User access token with `whatsapp_business_messaging` permissions. |
| `WHATSAPP_BUSINESS_ACCOUNT_ID` | Yes | Numeric ID | Meta WhatsApp Business Account (WABA) ID. |
| `WHATSAPP_TEMPLATE_NAME` | Yes | `hiralal_auth_otp` | Approved authentication template name in WhatsApp Business Manager. |
| `WHATSAPP_TEMPLATE_LANGUAGE` | Yes | `en_US` (or `hi`) | Language code for the authentication template. |
| `WHATSAPP_AUTH_BUTTON_TYPE` | No | `COPY_CODE` | Type of one-touch button configured on the WhatsApp message. |
| `MSG91_AUTH_KEY` | Optional | String | Fallback SMS provider authorization key. |
| `MSG91_TEMPLATE_ID` | Optional | String | Fallback SMS provider message template ID. |

---

## 5. Third-Party KYC & Banking Integrations

| Variable | Required | Expected Format | Purpose & Implementation |
|---|---|---|---|
| `SIGNCARE_BASE_URL` | Yes | `https://api.signcare.in` | Base URL for the SignCare PAN verification gateway. |
| `SIGNCARE_API_KEY` | Yes | String | Production API key for SignCare API authentication. |
| `SIGNCARE_APP_ID` | Yes | String | Application ID registered with SignCare. |
| `RAZORPAYX_KEY_ID` | Yes | `rzp_live_...` | RazorpayX API key ID for fund transfers and payouts. |
| `RAZORPAYX_KEY_SECRET` | Yes | String | RazorpayX API key secret. |
| `RAZORPAYX_ACCOUNT_NUMBER` | Yes | String | RazorpayX business virtual current account number. |
| `RAZORPAYX_WEBHOOK_SECRET` | Yes | String | Shared HMAC secret used to verify RazorpayX webhook signatures. |

---

## 6. Cloudflare R2 Storage

| Variable | Required | Expected Format | Purpose & Implementation |
|---|---|---|---|
| `R2_ACCESS_KEY_ID` | Yes | S3 Access Key | Cloudflare R2 API token access key ID. |
| `R2_SECRET_ACCESS_KEY` | Yes | S3 Secret Key | Cloudflare R2 API token secret access key. |
| `R2_BUCKET_NAME` | Yes | `hiralal-invoices-private` | Private bucket storing uploaded bill images and PDFs. |
| `R2_BACKUP_BUCKET` | Optional | `hiralal-backups-private` | Dedicated private R2 bucket for encrypted offsite database backups. |
| `R2_ENDPOINT` | Yes | `https://<account-id>.r2.cloudflarestorage.com` | S3-compatible API endpoint for Cloudflare R2. |
| `R2_SIGNED_URL_TTL_SECONDS` | No | `1800` (30 mins) | Time-to-live for generated presigned document download URLs. |

---

## 7. Operational Thresholds & Worker Timers

| Variable | Required | Default | Purpose & Implementation |
|---|---|---|---|
| `CORS_ALLOWED_ORIGINS` | Yes | Comma-separated URLs | Whitelist of origins permitted to access API endpoints (`https://hsspl.algions.in`). |
| `AUTH_LOCKOUT_SECONDS` | No | `900` (15 mins) | Duration of account lockout after repeated failed password attempts. |
| `AUTH_MAX_FAILED_ATTEMPTS` | No | `10` | Maximum failed password attempts before account lockout is enforced. |
| `OTP_TTL_SECONDS` | No | `300` (5 mins) | Time-to-live for issued OTP challenge codes. |
| `JWT_ACCESS_EXPIRES_IN` | No | `15m` | Token lifetime for user access JWTs. |
| `JWT_REFRESH_EXPIRES_IN` | No | `30d` | Token lifetime for user refresh tokens. |
| `BILL_MAX_UPLOAD_SIZE_MB` | No | `10` | Maximum permitted file size for uploaded bill invoices. |
| `SERVICE_ROLE` | No | `api` (`worker`, `all`) | Process role designation in Docker/multi-container deployments. |
| `MAX_DAILY_PAYOUT_AMOUNT` | No | `50000` (₹50,000) | Per-user maximum payout redemption volume permitted per calendar day IST. |
| `RETAIN_APPROVED_BILLS_FOR_AUDIT` | No | `true` (in prod) | Enforces 72/96-month statutory tax audit retention for approved tax invoices under Section 36 CGST Act. |
| `WORKER_PAYOUT_POLL_INTERVAL_MS`| No | `5000` (5s) | Interval at which the payout worker polls for pending dispatches. |
| `WORKER_RECONCILIATION_INTERVAL_MS` | No | `180000` (3m) | Interval at which the reconciliation worker processes unhandled webhooks. |
| `WORKER_DELETION_INTERVAL_MS` | No | `60000` (1m) | Interval at which the account deletion worker processes scheduled anonymizations. |

---

## 8. Google Play Integrity & Firebase Cloud Messaging (FCM)

| Variable | Required | Default / Format | Description & Scope |
|---|---|---|---|
| `PLAY_INTEGRITY_PACKAGE_NAME` | Yes | `com.hiralal.rewards` | Approved Android application package name verified against Play Integrity attestation tokens. |
| `PLAY_INTEGRITY_CLIENT_EMAIL` | Yes | Service Account Email | Google Cloud Service Account email authorized for Google Play Integrity API. |
| `PLAY_INTEGRITY_PRIVATE_KEY` | Yes | RSA Private Key PEM | Private RSA key matching service account for server-side token decryption/verification. |
| `PLAY_INTEGRITY_ALLOWED_CERT_DIGESTS` | Yes | Comma-separated 64-char hex | Allowed SHA-256 app signing certificate digests. |
| `PLAY_INTEGRITY_ALLOW_MOCK` | Yes | `false` | Disables mock attestation verdicts in production. |
| `PLAY_INTEGRITY_REQUIRE_LICENSING` | Yes | `true` | Requires valid Play Store licensing verdict for device attestation. |
| `PLAY_INTEGRITY_ENFORCE_ACTIONS` | Yes | `true` | Enforces request hash binding during registration/login. |
| `FCM_PROJECT_ID` / `FIREBASE_PROJECT_ID` | Optional | Firebase Project ID | Google Firebase project identifier for FCM push notifications. |
| `FCM_SERVICE_ACCOUNT_KEY` / `FIREBASE_SERVICE_ACCOUNT_KEY` | Optional | JSON string or path | Google Cloud Service Account credentials for FCM HTTP v1 push dispatch. |
