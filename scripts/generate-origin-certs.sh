#!/usr/bin/env bash
# ==============================================================================
# Hiralal & Sons - SSL Certificate Helper for Nginx
# ==============================================================================

set -euo pipefail

SSL_DIR="$(dirname "$0")/../nginx/ssl"
mkdir -p "${SSL_DIR}"

if [ ! -f "${SSL_DIR}/fullchain.pem" ] || [ ! -f "${SSL_DIR}/privkey.pem" ]; then
  echo "[INFO] Generating temporary self-signed SSL certificate for development/staging..."
  openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
    -keyout "${SSL_DIR}/privkey.pem" \
    -out "${SSL_DIR}/fullchain.pem" \
    -subj "/C=IN/ST=Bihar/L=Gopalganj/O=Hiralal and Sons Sales Pvt Ltd/CN=*.hiralalandsons.com"
  chmod 600 "${SSL_DIR}/privkey.pem"
  chmod 644 "${SSL_DIR}/fullchain.pem"
  echo "[SUCCESS] Self-signed certificates placed in ${SSL_DIR}."
  echo "[NOTE] For production, replace these with Cloudflare Origin CA certificate & private key."
else
  echo "[INFO] SSL certificates already exist in ${SSL_DIR}."
fi
