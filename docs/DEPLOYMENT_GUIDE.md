# Production Deployment & Third-Party Integration Guide

## Hiralal and Sons Sales Pvt. Ltd. - Rewards Management System

### 1. Cloudflare R2 Private Document Storage

1. Create a Cloudflare account and create an R2 bucket named `hiralal-invoices-private`.
2. Generate an R2 API Token with **Object Read & Write** permissions.
3. Configure the environment variables:
   ```env
   CLOUDFLARE_R2_ACCOUNT_ID="<your_cf_account_id>"
   CLOUDFLARE_R2_ACCESS_KEY_ID="<your_r2_access_key>"
   CLOUDFLARE_R2_SECRET_ACCESS_KEY="<your_r2_secret_key>"
   CLOUDFLARE_R2_BUCKET_NAME="hiralal-invoices-private"
   ```
4. **Security Notice**: Do NOT make the bucket public. The backend serves time-limited signed HMAC URLs (`/api/bills/file`) expiring in 15 minutes.

---

### 2. RazorpayX Payouts & Webhooks Setup

1. Open your RazorpayX dashboard and obtain your **Key ID** and **Key Secret**.
2. Configure your Current Account Number for corporate payouts:
   ```env
   RAZORPAYX_KEY_ID="rzp_live_..."
   RAZORPAYX_KEY_SECRET="..."
   RAZORPAYX_ACCOUNT_NUMBER="2323230041123456"
   RAZORPAYX_WEBHOOK_SECRET="..."
   ```
3. Set Webhook URL in RazorpayX Dashboard:
   - **URL**: `https://api.hiralalandsons.com/api/webhooks/razorpayx`
   - **Events**:
     - `payout.processed`
     - `payout.reversed`
     - `payout.failed`

---

### 3. Indian SMS Gateway Configuration

Configure SMS provider for OTP transmission:
```env
SMS_GATEWAY_PROVIDER="FAST2SMS" # Options: FAST2SMS, MSG91, TEXTLOCAL
SMS_API_KEY="<your_sms_gateway_api_key>"
```

---

### 4. KYC / PAN Verification Provider

Configure authorized Indian KYC provider (e.g. Surepass, Karza, Zoop):
```env
KYC_PROVIDER="SUREPASS" # Options: SUREPASS, KARZA, ZOOP, MOCK
KYC_API_KEY="<your_kyc_api_key>"
```

---

### 5. Production Docker Deployment

Deploy the entire stack with a single command:

```bash
docker compose up -d --build
```

This starts:
- **PostgreSQL 16** with persistent volume on port `5432`
- **Backend API Server** on port `5000`
- **Admin Dashboard** on port `3000`
