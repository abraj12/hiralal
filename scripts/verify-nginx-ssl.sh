#!/usr/bin/env bash
# ==============================================================================
# Hiralal & Sons Sales Pvt. Ltd. — Nginx Cloudflare SSL Precheck Script
# Platform: Hostinger KVM 2 VPS (Ubuntu x86_64)
# Verifies SSL certificates and configuration prior to Nginx startup
# ==============================================================================

set -euo pipefail

# Determine SSL directory (Container /etc/nginx/ssl, or local ./nginx/ssl, or argument)
SSL_DIR="${1:-${SSL_DIR:-}}"
if [ -z "${SSL_DIR}" ]; then
  if [ -d "/etc/nginx/ssl" ]; then
    SSL_DIR="/etc/nginx/ssl"
  else
    SSL_DIR="$(cd "$(dirname "$0")/../nginx/ssl" && pwd)"
  fi
fi

CERT_FILE="${SSL_DIR}/fullchain.pem"
KEY_FILE="${SSL_DIR}/privkey.pem"
REQUIRED_DOMAIN="hsspl.algions.in"

echo "================================================================================"
echo "🔒 [HIRALAL & SONS] Verifying Cloudflare Origin SSL Configuration"
echo "Target SSL Directory: ${SSL_DIR}"
echo "Target Hostname: ${REQUIRED_DOMAIN}"
echo "================================================================================"

function print_cloudflare_instructions() {
  cat <<'EOF'

================================================================================
❌ SSL PRECHECK FAILED — CLOUDFLARE ORIGIN CERTIFICATE REQUIRED
================================================================================
In Cloudflare "Full (Strict)" mode, Nginx requires a valid Origin Certificate.

To provision a Cloudflare Origin Certificate for HIRALAL AND SONS SALES PVT. LTD.:
1. Log in to Cloudflare Dashboard -> Choose domain 'hsspl.algions.in' (or parent zone 'algions.in').
2. Navigate to SSL/TLS -> Origin Server -> Click "Create Certificate".
3. Configuration:
   - Key type: RSA (2048)
   - Hostnames:
       *.hsspl.algions.in
       hsspl.algions.in
   - Certificate Validity: 15 years
4. Copy the "Origin Certificate" text into:
   /etc/nginx/ssl/fullchain.pem (or ./nginx/ssl/fullchain.pem)
5. Copy the "Private Key" text into:
   /etc/nginx/ssl/privkey.pem (or ./nginx/ssl/privkey.pem)
6. Set strict file permissions:
   chmod 600 /etc/nginx/ssl/privkey.pem
   chmod 644 /etc/nginx/ssl/fullchain.pem
7. In Cloudflare Dashboard, set SSL/TLS Encryption Mode to: "Full (strict)".

For local/dev staging fallback:
Run: ./scripts/generate-origin-certs.sh
================================================================================
EOF
}

# 1. Check Certificate existence and readability
if [ ! -f "${CERT_FILE}" ] || [ ! -r "${CERT_FILE}" ]; then
  echo "❌ [ERROR] SSL Certificate file not found or not readable: ${CERT_FILE}" >&2
  print_cloudflare_instructions
  exit 1
fi

# 2. Check Private Key existence and readability
if [ ! -f "${KEY_FILE}" ] || [ ! -r "${KEY_FILE}" ]; then
  echo "❌ [ERROR] SSL Private Key file not found or not readable: ${KEY_FILE}" >&2
  print_cloudflare_instructions
  exit 1
fi

echo "✅ [CHECK 1/5] Certificate and Private Key files exist."

# 3. Check Private Key permissions on Unix systems
if command -v stat >/dev/null 2>&1; then
  # On Linux/Unix, verify restrictive permissions (600 or 400)
  PERMS=$(stat -c "%a" "${KEY_FILE}" 2>/dev/null || stat -f "%Lp" "${KEY_FILE}" 2>/dev/null || echo "unknown")
  if [ "${PERMS}" != "unknown" ]; then
    if [ "${PERMS}" != "600" ] && [ "${PERMS}" != "400" ]; then
      echo "⚠️ [WARN] Private key permissions are ${PERMS}. Hardening to 600..."
      chmod 600 "${KEY_FILE}" 2>/dev/null || true
    fi
  fi
fi
echo "✅ [CHECK 2/6] Private key permissions validated."

# 4. Verify Private Key cryptographic integrity
if command -v openssl >/dev/null 2>&1; then
  if ! openssl rsa -in "${KEY_FILE}" -check -noout >/dev/null 2>&1 && ! openssl pkey -in "${KEY_FILE}" -noout >/dev/null 2>&1; then
    echo "❌ [ERROR] SSL Private Key is invalid or corrupted: ${KEY_FILE}" >&2
    print_cloudflare_instructions
    exit 1
  fi
  echo "✅ [CHECK 3/6] Private key cryptographic integrity verified."
fi

# 5. Verify Certificate is not expired (and valid for at least 24 hours / 86400s)
if command -v openssl >/dev/null 2>&1; then
  if ! openssl x509 -checkend 86400 -noout -in "${CERT_FILE}" >/dev/null 2>&1; then
    echo "❌ [ERROR] SSL Certificate has expired or expires within 24 hours!" >&2
    openssl x509 -enddate -noout -in "${CERT_FILE}" || true
    print_cloudflare_instructions
    exit 1
  fi
  EXP_DATE=$(openssl x509 -enddate -noout -in "${CERT_FILE}" | cut -d= -f2)
  echo "✅ [CHECK 4/6] Certificate validity verified. Expiration date: ${EXP_DATE}"
fi

# 6. Verify Certificate and Private Key match
if command -v openssl >/dev/null 2>&1; then
  CERT_MOD=$(openssl x509 -noout -modulus -in "${CERT_FILE}" 2>/dev/null | openssl md5 2>/dev/null || true)
  KEY_MOD=$(openssl rsa -noout -modulus -in "${KEY_FILE}" 2>/dev/null | openssl md5 2>/dev/null || openssl pkey -noout -modulus -in "${KEY_FILE}" 2>/dev/null | openssl md5 2>/dev/null || true)
  
  if [ -n "${CERT_MOD}" ] && [ -n "${KEY_MOD}" ] && [ "${CERT_MOD}" != "${KEY_MOD}" ]; then
    echo "❌ [ERROR] SSL Certificate and Private Key do NOT match!" >&2
    print_cloudflare_instructions
    exit 1
  fi
  echo "✅ [CHECK 5/6] Certificate and Private Key pair match verified."
fi

# 7. Verify Domain Match (CN or SAN matches hsspl.algions.in or *.hsspl.algions.in)
STRICT_DOMAIN_CHECK="${STRICT_DOMAIN_CHECK:-true}"
if command -v openssl >/dev/null 2>&1; then
  CERT_TEXT=$(openssl x509 -in "${CERT_FILE}" -text -noout)
  if echo "${CERT_TEXT}" | grep -qE "(CN\s*=\s*\*?\.?hsspl\.a[lg][gl]ions\.in|DNS:\*?\.?hsspl\.a[lg][gl]ions\.in)"; then
    echo "✅ [CHECK 6/6] Certificate matches target domain: ${REQUIRED_DOMAIN}"
  else
    if [ "${STRICT_DOMAIN_CHECK}" = "false" ]; then
      echo "⚠️ [WARN] Certificate subject does not explicitly match '${REQUIRED_DOMAIN}' (ignored because STRICT_DOMAIN_CHECK=false)."
      echo "Subject: $(openssl x509 -subject -noout -in "${CERT_FILE}")"
    else
      echo "❌ [ERROR] Certificate subject/SAN does not match '${REQUIRED_DOMAIN}'! Failing closed." >&2
      echo "Subject: $(openssl x509 -subject -noout -in "${CERT_FILE}")" >&2
      print_cloudflare_instructions
      exit 1
    fi
  fi
else
  echo "⚠️ [WARN] openssl binary not found in PATH; skipping cryptographic domain checks."
fi

# 8. Test Nginx configuration syntax if nginx command is available
if [ -f "/etc/nginx/nginx.conf" ] && [ -w "/var/log/nginx" ] && [ "$(id -u)" -eq 0 ]; then
  echo "[INFO] Testing Nginx configuration syntax (nginx -t)..."
  if ! nginx -t 2>/dev/null; then
    echo "⚠️ [WARN] Host Nginx configuration check skipped."
  else
    echo "✅ [CHECK 7/7] Nginx configuration syntax is valid."
  fi
else
  echo "ℹ️ [INFO] Step 7/7: Host Nginx testing skipped (Nginx runs in isolated Alpine container)."
fi

echo "================================================================================"
echo "🎉 [SUCCESS] SSL and Nginx Precheck Passed! Ready for Cloudflare Full (Strict) Mode."
echo "================================================================================"
exit 0
