# API Documentation

## Hiralal and Sons Sales Pvt. Ltd. - Rewards Management API

Base URL: `http://localhost:5000/api`

---

### Authentication Endpoints

#### 1. Send OTP
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
    "message": "OTP sent successfully to +91 9876543210",
    "otpDebug": "123456"
  }
  ```

#### 2. Register
- **Method**: `POST`
- **Path**: `/auth/register`
- **Body**:
  ```json
  {
    "mobile": "9876543210",
    "fullName": "Raj Kumar",
    "password": "Password@123",
    "profession": "PLUMBER",
    "otpCode": "123456"
  }
  ```

#### 3. Login
- **Method**: `POST`
- **Path**: `/auth/login`
- **Body**:
  ```json
  {
    "mobile": "9876543210",
    "password": "Password@123"
  }
  ```

#### 4. Admin Login
- **Method**: `POST`
- **Path**: `/auth/admin-login`
- **Body**:
  ```json
  {
    "username": "9999999999",
    "password": "Admin@123"
  }
  ```

---

### Bills Endpoints

#### 1. Upload Bill
- **Method**: `POST`
- **Path**: `/bills`
- **Headers**: `Authorization: Bearer <TOKEN>`
- **Body** (`multipart/form-data` or JSON):
  ```json
  {
    "invoiceNumber": "INV-2026-001",
    "invoiceDate": "2026-10-04",
    "billAmount": 100000,
    "remarks": "Pipes & CPVC Fittings"
  }
  ```

#### 2. Get User Bills
- **Method**: `GET`
- **Path**: `/bills?status=ALL`
- **Headers**: `Authorization: Bearer <TOKEN>`

#### 3. Secure Invoice File Access
- **Method**: `GET`
- **Path**: `/bills/file?key=invoices/user/bill.pdf&expires=1791140000&sig=abcdef...`
- **Description**: Validates cryptographic HMAC signature. Rejects expired or unauthorized file requests.

---

### Rewards & Wallet Endpoints

#### 1. Get Wallet
- **Method**: `GET`
- **Path**: `/wallet`
- **Headers**: `Authorization: Bearer <TOKEN>`

#### 2. Redeem Rewards
- **Method**: `POST`
- **Path**: `/payouts/redeem`
- **Headers**: `Authorization: Bearer <TOKEN>`
- **Body**:
  ```json
  {
    "amount": 1600.0,
    "idempotencyKey": "idem-uuid-12345"
  }
  ```

---

### Admin Endpoints (RBAC Protected)

#### 1. Get Dashboard
- **Method**: `GET`
- **Path**: `/admin/dashboard`
- **Headers**: `Authorization: Bearer <ADMIN_TOKEN>`

#### 2. Verify Bill (Approve / Reject)
- **Method**: `POST`
- **Path**: `/admin/bills/:id/verify`
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
    "rejectionReason": "Blurry invoice photo. Date unreadable."
  }
  ```

#### 3. Update Reward Rules
- **Method**: `PUT`
- **Path**: `/admin/settings/reward-rules`
- **Headers**: `Authorization: Bearer <ADMIN_TOKEN>`
- **Body**:
  ```json
  {
    "percentage": 0.5,
    "monthlyPoolLimit": 50000,
    "minRedemptionAmount": 500
  }
  ```
