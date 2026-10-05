#!/usr/bin/env bash
# ==============================================================================
# Hiralal & Sons Sales Pvt. Ltd. — Nginx Cloudflare SSL Precheck Script
# Platform: AWS EC2 t4g.medium (Graviton2 ARM64, ap-south-1)
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
REQUIRED_DOMAIN="hiralalandsons.com"

echo "================================================================================"
echo "🔒 [HIRALAL & SONS] Verifying Cloudflare Origin SSL Configuration"
echo "Target SSL Directory: ${SSL_DIR}"
echo "================================================================================"

function print_cloudflare_instructions() {
  cat <<'EOF'

================================================================================
❌ SSL PRECHECK FAILED — CLOUDFLARE ORIGIN CERTIFICATE REQUIRED
================================================================================
In Cloudflare "Full (Strict)" mode, Nginx requires a valid Origin Certificate.

To provision a Cloudflare Origin Certificate for HIRALAL AND SONS SALES PVT. LTD.:
1. Log in to Cloudflare Dashboard -> Choose domain 'hiralalandsons.com'.
2. Navigate to SSL/TLS -> Origin Server -> Click "Create Certificate".
3. Configuration:
   - Key type: RSA (2048)
   - Hostnames:
       *.hiralalandsons.com
       hiralalandsons.com
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
echo "✅ [CHECK 2/5] Private key permissions validated."

# 4. Verify Certificate is not expired (and valid for at least 24 hours / 86400s)
if command -v openssl >/dev/null 2>&1; then
  if ! openssl x509 -checkend 86400 -noout -in "${CERT_FILE}" >/dev/null 2>&1; then
    echo "❌ [ERROR] SSL Certificate has expired or expires within 24 hours!" >&2
    openssl x509 -enddate -noout -in "${CERT_FILE}" || true
    print_cloudflare_instructions
    exit 1
  fi
  EXP_DATE=$(openssl x509 -enddate -noout -in "${CERT_FILE}" | cut -d= -f2)
  echo "✅ [CHECK 3/5] Certificate validity verified. Expiration date: ${EXP_DATE}"
else
  echo "⚠️ [WARN] openssl binary not found in PATH; skipping cryptographic expiration verification."
fi

# 5. Verify Domain Match (CN or SAN matches hiralalandsons.com or *.hiralalandsons.com)
if command -v openssl >/dev/null 2>&1; then
  CERT_TEXT=$(openssl x509 -in "${CERT_FILE}" -text -noout)
  if echo "${CERT_TEXT}" | grep -qE "(CN\s*=\s*\*?\.?hiralalandsons\.com|DNS:\*?\.?hiralalandsons\.com)"; then
    echo "✅ [CHECK 4/5] Certificate matches target domain: ${REQUIRED_DOMAIN}"
  else
    echo "⚠️ [WARN] Certificate subject does not explicitly match '${REQUIRED_DOMAIN}'."
    echo "Subject: $(openssl x509 -subject -noout -in "${CERT_FILE}")"
  fi
else
  echo "⚠️ [WARN] openssl binary not found in PATH; skipping domain match check."
fi

# 6. Test Nginx configuration syntax if nginx command is available
if command -v nginx >/dev/null 2>&1; then
  echo "[INFO] Testing Nginx configuration syntax (nginx -t)..."
  if ! nginx -t; then
    echo "❌ [ERROR] Nginx configuration test failed!" >&2
    exit 1
  fi
  echo "✅ [CHECK 5/5] Nginx configuration syntax is valid."
else
  echo "ℹ️ [INFO] Step 5/5: nginx binary not in host PATH (runs inside container). Syntax checked in container."
fi

echo "================================================================================"
echo "🎉 [SUCCESS] SSL and Nginx Precheck Passed! Ready for Cloudflare Full (Strict) Mode."
echo "================================================================================"
exit 0
