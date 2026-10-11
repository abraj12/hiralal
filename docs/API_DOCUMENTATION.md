# API Documentation

## Hiralal and Sons Sales Pvt. Ltd. — Rewards Management API
**Production Base URL:** `https://hsspl.algions.in/api`  
**Development Base URL:** `http://localhost:5000/api`

All financial values are denominated in Indian Rupees (₹) with 2-decimal paise precision.

---

### 1. Authentication Endpoints

#### 1.1 Request OTP (Craftsman / User)
- **Method**: `POST`
- **Path**: `/auth/send-otp`
- **Body**:
  ```json
  {
    "mobile": "9876543210",
    "purpose": "REGISTRATION" // or "FORGOT_PASSWORD", "LOGIN"
  }
  ```
- **Response (200)**:
  ```json
  {
    "success": true,
    "message": "OTP sent successfully to +91 9876543210"
  }
  ```
  *(Note: OTP codes are transmitted via MSG91 SMS and are strictly never returned in API responses).*

#### 1.2 User Registration
- **Method**: `POST`
- **Path**: `/auth/register`
- **Body**:
  ```json
  {
    "mobile": "9876543210",
    "fullName": "Ramesh Kumar",
    "password": "StrongPassword123!",
    "profession": "PLUMBER", // "PLUMBER" or "TILE_INSTALLER"
    "otpCode": "123456"
  }
  ```
- **Response (201)**:
  ```json
  {
    "success": true,
    "token": "<JWT_ACCESS_TOKEN>",
    "user": {
      "id": "uuid",
      "mobile": "9876543210",
      "fullName": "Ramesh Kumar",
      "profession": "PLUMBER",
      "role": "USER"
    }
  }
  ```

#### 1.3 User Login (Password-First)
- **Method**: `POST`
- **Path**: `/auth/login`
- **Body**:
  ```json
  {
    "identifier": "9876543210",
    "password": "StrongPassword123!"
  }
  ```
- **Response (200)**:
  ```json
  {
    "success": true,
    "kind": "USER_AUTHENTICATED",
    "session": {
      "accessToken": "<JWT_ACCESS_TOKEN>",
      "refreshToken": "<REFRESH_TOKEN>",
      "user": {
        "id": "uuid",
        "mobile": "9876543210",
        "fullName": "Ramesh Kumar",
        "profession": "PLUMBER",
        "role": "USER"
      }
    }
  }
  ```

#### 1.4 Admin Login (Password-First Two-Factor Challenge Flow)
Admin authentication requires prefix-based identifiers (`BILL_ADMIN_PREFIX` or `OPERATIONS_ADMIN_PREFIX`) and a password-first verification challenge:

**Step 1: Challenge Initiation**
- **Method**: `POST`
- **Path**: `/auth/login`
- **Body**:
  ```json
  {
    "identifier": "BADM9876543210",
    "password": "StrongBillAdminPassword123!"
  }
  ```
- **Response (200)**:
  ```json
  {
    "kind": "ADMIN_OTP_REQUIRED",
    "challengeToken": "<CHALLENGE_TOKEN_UUID>",
    "requiresOtp": true,
    "role": "BILL_ADMIN",
    "mobileMasked": "***3210",
    "message": "Admin verification code dispatched."
  }
  ```

**Step 2: Verify OTP Challenge**
- **Method**: `POST`
- **Path**: `/auth/admin/otp/verify`
- **Body**:
  ```json
  {
    "identifier": "BADM9876543210",
    "challengeToken": "<CHALLENGE_TOKEN_UUID>",
    "otpCode": "654321"
  }
  ```
- **Response Headers**:
  - `Set-Cookie: admin_access_token=<JWT>; HttpOnly; Secure; SameSite=Lax; Path=/`
- **Response (200)**:
  ```json
  {
    "success": true,
    "accessToken": "<ADMIN_JWT_ACCESS_TOKEN>",
    "user": {
      "id": "uuid",
      "mobile": "9876543210",
      "role": "BILL_ADMIN"
    }
  }
  ```

---

### 2. Bill Submission & Verification Endpoints

#### 2.1 Submit Purchase Bill (Craftsman)
- **Method**: `POST`
- **Path**: `/bills`
- **Headers**: `Authorization: Bearer <USER_TOKEN>`
- **Content-Type**: `multipart/form-data`
- **Form Fields**:
  - `invoiceNumber`: `"INV-2026-9901"`
  - `invoiceDate`: `"2026-10-10"` (YYYY-MM-DD)
  - `billAmount`: `10000.00`
  - `invoiceFile`: `[Binary PDF / JPEG / PNG up to 10MB]`
  - `remarks`: `"CPVC fittings and pipes"` (Optional)
- **Response (201)**:
  ```json
  {
    "success": true,
    "message": "Bill uploaded successfully and submitted for administrator verification.",
    "bill": {
      "id": "bill-uuid",
      "invoiceNumber": "INV-2026-9901",
      "invoiceDate": "2026-10-10T00:00:00.000Z",
      "billAmount": 10000,
      "status": "PENDING"
    }
  }
  ```

#### 2.2 List User Bills
- **Method**: `GET`
- **Path**: `/bills?status=ALL` (or `status=PENDING`, `status=APPROVED`, `status=REJECTED`)
- **Headers**: `Authorization: Bearer <USER_TOKEN>`

#### 2.3 Get Bill Document Signed URL (Bill Admin Only)
- **Method**: `GET`
- **Path**: `/admin/bills/:id/document-url`
- **Headers**: `Authorization: Bearer <ADMIN_TOKEN>`
- **Response (200)**:
  ```json
  {
    "success": true,
    "documentUrl": "https://<account-id>.r2.cloudflarestorage.com/bills/...?X-Amz-Signature=...",
    "mimeType": "application/pdf",
    "expiresIn": 1800
  }
  ```

#### 2.4 Verify Bill (Bill Admin Only)
- **Method**: `POST`
- **Path**: `/admin/bills/:id/verify`
- **Headers**: `Authorization: Bearer <ADMIN_TOKEN>`
- **Approve with Configured GST Rule**:
  ```json
  {
    "action": "APPROVE",
    "gstIncluded": true,
    "gstRuleId": "gst-rule-uuid",
    "gstRate": 18.0
  }
  ```
- **Approve with Manual GST Override**:
  ```json
  {
    "action": "APPROVE",
    "gstIncluded": true,
    "gstRate": 12.0,
    "gstOverrideReason": "Concessional tax rate verified on physical tax invoice"
  }
  ```
- **Approve without GST Deduction**:
  ```json
  {
    "action": "APPROVE",
    "gstIncluded": false
  }
  ```
- **Reject Bill**:
  ```json
  {
    "action": "REJECT",
    "rejectionReason": "Invoice image blurred; invoice number unreadable"
  }
  ```
- **Response (200)**:
  ```json
  {
    "success": true,
    "message": "Bill approved and reward credited to user wallet.",
    "bill": {
      "id": "bill-uuid",
      "status": "APPROVED",
      "calculatedReward": 42.37,
      "eligibleRewardAmount": 8474.58,
      "gstAmount": 1525.42,
      "rewardRateSnapshot": 0.5
    }
  }
  ```

---

### 3. Wallet & Payout Endpoints

#### 3.1 Get Wallet Balance & Transaction History
- **Method**: `GET`
- **Path**: `/wallet`
- **Headers**: `Authorization: Bearer <USER_TOKEN>`
- **Response (200)**:
  ```json
  {
    "success": true,
    "wallet": {
      "availableBalance": 1250.75,
      "processingAmount": 0,
      "totalRedeemed": 5000.00
    },
    "transactions": [...]
  }
  ```

#### 3.2 Request Reward Redemption (Craftsman)
Requests 100% full available balance redemption. Has no minimum or maximum threshold:
- **Method**: `POST`
- **Path**: `/payouts/request`
- **Headers**: `Authorization: Bearer <USER_TOKEN>`
- **Body**:
  ```json
  {
    "idempotencyKey": "redemption-user123-20261011-001"
  }
  ```
- **Response (200)**:
  ```json
  {
    "success": true,
    "amountDebited": 1250.75,
    "payout": {
      "id": "payout-uuid",
      "amount": 1250.75,
      "status": "PENDING"
    }
  }
  ```

#### 3.3 Operations Admin Payout Action (Operations Admin Only)
- **Method**: `POST`
- **Path**: `/admin/payouts/:id/action`
- **Headers**: `Authorization: Bearer <ADMIN_TOKEN>`
- **Body (Approve)**:
  ```json
  {
    "action": "APPROVE"
  }
  ```
- **Body (Reject)**:
  ```json
  {
    "action": "REJECT",
    "rejectionReason": "Bank account IFSC mismatch; re-verification requested"
  }
  ```

#### 3.4 RazorpayX Gateway Webhook
- **Method**: `POST`
- **Path**: `/payouts/webhook`
- **Headers**: `x-razorpay-signature: <HMAC_SHA256_HEX>`
- **Body**: RazorpayX event payload (`payout.processed`, `payout.reversed`, `payout.failed`).

---

### 4. Push & In-App Notification Endpoints

#### 4.1 Get User In-App Notifications
- **Method**: `GET`
- **Path**: `/notifications?page=1&limit=20`
- **Headers**: `Authorization: Bearer <USER_TOKEN>`

#### 4.2 Get Unread Notification Count
- **Method**: `GET`
- **Path**: `/notifications/unread-count`
- **Headers**: `Authorization: Bearer <USER_TOKEN>`

#### 4.3 Register Device Push Token (FCM HTTP v1)
- **Method**: `POST`
- **Path**: `/notifications/device-token`
- **Headers**: `Authorization: Bearer <USER_TOKEN>`
- **Body**:
  ```json
  {
    "token": "fcm_device_token_string",
    "platform": "ANDROID" // "ANDROID", "IOS", "WEB"
  }
  ```

#### 4.4 Deactivate Device Token (Logout)
- **Method**: `DELETE`
- **Path**: `/notifications/device-token/:token`
- **Headers**: `Authorization: Bearer <USER_TOKEN>`

#### 4.5 Broadcast Notification (Operations Admin Only)
- **Method**: `POST`
- **Path**: `/admin/notifications/broadcast`
- **Headers**: `Authorization: Bearer <ADMIN_TOKEN>`
- **Body**:
  ```json
  {
    "title": "Diwali Double Rewards",
    "message": "Special festive rewards active on all PVC and tile purchases!",
    "targetAudience": "PLUMBER", // "ALL", "PLUMBER", "TILE_INSTALLER"
    "idempotencyKey": "broadcast-diwali-2026"
  }
  ```

---

### 5. Administrative Settings & Review Endpoints

#### Role-Based Access Control (RBAC) Matrix
| Endpoint | Method | Permitted Role | Purpose |
| :--- | :--- | :--- | :--- |
| `/admin/bills` | `GET` | `BILL_ADMIN` | List and filter worker bills for verification |
| `/admin/bills/:id/document-url` | `GET` | `BILL_ADMIN` | Generate 1800s temporary S3 signed URL for invoice inspection |
| `/admin/bills/:id/review-config` | `GET` | `BILL_ADMIN` | Inspect applicable reward rule & GST rules for a bill's `invoiceDate` |
| `/admin/bills/:id/verify` | `POST` | `BILL_ADMIN` | Approve or reject bill with reverse-GST computation |
| `/admin/settings/reward-rules` | `GET` | `OPERATIONS_ADMIN` | List all versioned reward rules across professions |
| `/admin/settings/reward-rules` | `POST` | `OPERATIONS_ADMIN` | Deploy new versioned reward rule with effective date |
| `/admin/settings/gst-rules` | `GET` | `OPERATIONS_ADMIN` | List active GST tax treatment rules |
| `/admin/settings/gst-rules` | `POST` | `OPERATIONS_ADMIN` | Create new standard or concessional GST rule |
| `/admin/settings/redemption` | `GET`, `POST` | `OPERATIONS_ADMIN` | Configure scheduled redemption calendar windows |
| `/admin/payouts` | `GET`, `POST` | `OPERATIONS_ADMIN` | Review and approve/reject craftsman redemptions |

*Note: Accessing any `OPERATIONS_ADMIN` endpoint with a `BILL_ADMIN` token strictly returns `403 Forbidden` (`code: "FORBIDDEN"`). Hiding UI links is supplemented by strict server-side middleware enforcement.*

#### 5.1 List Reward Rules (Operations Admin Only)
- **Method**: `GET`
- **Path**: `/admin/settings/reward-rules?profession=PLUMBER` // or "TILE_INSTALLER", "ALL"
- **Headers**: `Authorization: Bearer <OPERATIONS_ADMIN_TOKEN>`

#### 5.2 Deploy Versioned Reward Rule (Operations Admin Only)
- **Method**: `POST`
- **Path**: `/admin/settings/reward-rules`
- **Headers**: `Authorization: Bearer <OPERATIONS_ADMIN_TOKEN>`
- **Body**:
  ```json
  {
    "profession": "PLUMBER", // "PLUMBER" or "TILE_INSTALLER"
    "rewardPercentage": 0.50, // Finite number between 0.01% and 10.00%
    "effectiveFrom": "2026-10-15" // Invoices on or after this date receive this rate
  }
  ```
- **Response (201)**:
  ```json
  {
    "success": true,
    "message": "New versioned rule (v2) created for PLUMBER.",
    "rule": {
      "id": "rule-uuid",
      "profession": "PLUMBER",
      "version": 2,
      "rewardPercentage": 0.50,
      "effectiveFrom": "2026-10-15T00:00:00.000Z",
      "effectiveUntil": null,
      "isActive": true
    }
  }
  ```

#### 5.3 Inspect Applicable Review Rules for Bill Verification (Bill Admin)
- **Method**: `GET`
- **Path**: `/admin/bills/:id/review-config`
- **Headers**: `Authorization: Bearer <BILL_ADMIN_TOKEN>`
- **Response (200)**:
  ```json
  {
    "success": true,
    "billId": "bill-uuid",
    "invoiceDate": "2026-10-01T00:00:00.000Z",
    "profession": "PLUMBER",
    "rewardRule": {
      "id": "rule-uuid",
      "version": 1,
      "rewardPercentage": 0.50,
      "effectiveFrom": "2020-01-01T00:00:00.000Z",
      "effectiveUntil": null
    },
    "gstRules": [
      {
        "id": "gst-18-uuid",
        "ratePercentage": 18.0,
        "description": "Standard 18% GST"
      }
    ]
  }
  ```
