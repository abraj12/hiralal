#!/usr/bin/env bash
# ==============================================================================
# Hiralal & Sons Sales Pvt. Ltd. - Production Server Hardening & Provisioning
# Platform: Hostinger KVM 2 VPS (2 vCPU, 8 GB RAM, 100 GB NVMe, Ubuntu x86_64)
# Target OS: Ubuntu 24.04 / 22.04 LTS (x86_64 / amd64)
# Invariant: Strict security hardening, UFW firewall, fail2ban, Nginx TLS, Docker
# ==============================================================================

set -euo pipefail

echo "========================================================================"
echo "Hiralal & Sons — Hostinger KVM 2 Production Server Setup & Hardening"
echo "========================================================================"

# Require root/sudo execution
if [ "$(id -u)" -ne 0 ]; then
  echo "[FATAL ERROR] This script must be executed as root or with sudo." >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive

# 1. System Package Update & Base Tooling Installation
echo "==> [1/7] Updating system packages and installing base security tools..."
apt-get update && apt-get upgrade -y
apt-get install -y \
  ca-certificates \
  curl \
  gnupg \
  lsb-release \
  git \
  openssl \
  gzip \
  ufw \
  fail2ban \
  certbot \
  python3-certbot-nginx \
  unattended-upgrades \
  apparmor \
  apparmor-utils

# 2. Linux Kernel & Sysctl Network Hardening
echo "==> [2/7] Applying Linux kernel and sysctl network security hardening..."
SYSCTL_CONF="/etc/sysctl.d/99-hiralal-security.conf"
cat << 'EOF' > "${SYSCTL_CONF}"
# Protection against TCP SYN flood attacks
net.ipv4.tcp_syncookies = 1
net.ipv4.tcp_max_syn_backlog = 4096
net.ipv4.tcp_synack_retries = 2

# IP Spoofing protection (Reverse Path Filtering)
net.ipv4.conf.all.rp_filter = 1
net.ipv4.conf.default.rp_filter = 1

# Ignore ICMP Broadcast Echo Requests (Smurf attack mitigation)
net.ipv4.icmp_echo_ignore_broadcasts = 1

# Disable ICMP redirect acceptance
net.ipv4.conf.all.accept_redirects = 0
net.ipv4.conf.default.accept_redirects = 0
net.ipv6.conf.all.accept_redirects = 0
net.ipv6.conf.default.accept_redirects = 0

# Disable IP Source Routing
net.ipv4.conf.all.accept_source_route = 0
net.ipv4.conf.default.accept_source_route = 0

# Log Martian Packets (impossible addresses)
net.ipv4.conf.all.log_martians = 1
net.ipv4.conf.default.log_martians = 1

# Keep IP forwarding enabled for Docker container networking
net.ipv4.ip_forward = 1
EOF

sysctl --system > /dev/null 2>&1 || true

# 3. UFW (Uncomplicated Firewall) Hardening
echo "==> [3/7] Hardening firewall (UFW) with least-privilege incoming rules..."
ufw --force reset > /dev/null 2>&1 || true
ufw default deny incoming
ufw default allow outgoing

# Allow SSH management port (default 22)
SSH_PORT="${SSH_PORT:-22}"
ufw allow "${SSH_PORT}/tcp" comment "SSH Remote Administration"

# Allow HTTP and HTTPS (Nginx Edge & ACME / Let's Encrypt / Cloudflare)
# SEC-HIGH-03: Restrict ingress to Cloudflare edge CIDR blocks when RESTRICT_CLOUDFLARE_IPS=true
if [ "${RESTRICT_CLOUDFLARE_IPS:-false}" = "true" ]; then
  echo "==> Restricting HTTP/HTTPS ingress exclusively to Cloudflare edge CIDR blocks..."
  CF_IPV4="173.245.48.0/20 103.21.244.0/22 103.22.200.0/22 103.31.4.0/22 141.101.64.0/18 108.162.192.0/18 190.93.240.0/20 188.114.96.0/20 197.234.240.0/22 198.41.128.0/17 162.158.0.0/15 104.16.0.0/13 104.24.0.0/14 172.64.0.0/13 131.0.72.0/22"
  for cidr in ${CF_IPV4}; do
    ufw allow proto tcp from "${cidr}" to any port 80,443 comment "Cloudflare Edge Ingress"
  done
else
  ufw allow 80/tcp comment "Nginx HTTP / ACME Challenge"
  ufw allow 443/tcp comment "Nginx HTTPS Production TLS"
fi

# Explicitly block external access to internal data and application ports
# (PostgreSQL 5432, Redis 6379, Backend API 5000, Admin Panel 3000)
ufw deny 5432/tcp comment "Deny external PostgreSQL access"
ufw deny 6379/tcp comment "Deny external Redis access"
ufw deny 5000/tcp comment "Deny direct external Backend API access"
ufw deny 3000/tcp comment "Deny direct external Admin Next.js access"

ufw --force enable
ufw status verbose

# 4. Fail2ban SSH Brute-Force Hardening
echo "==> [4/7] Configuring Fail2ban SSH intrusion defense..."
cat << 'EOF' > /etc/fail2ban/jail.d/sshd.local
[sshd]
enabled = true
port = ssh
filter = sshd
logpath = /var/log/auth.log
maxretry = 5
findtime = 600
bantime = 3600
EOF

systemctl enable fail2ban
systemctl restart fail2ban

# 5. Docker Engine & Docker Compose Plugin Installation (Official Repo)
echo "==> [5/7] Installing Docker Engine & Compose plugin (Ubuntu x86_64)..."
if ! command -v docker > /dev/null 2>&1; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg
  echo \
    "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
    $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
    tee /etc/apt/sources.list.d/docker.list > /dev/null
  apt-get update
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  systemctl enable docker
  systemctl start docker
fi

# 6. Process Management & Application Directory Layout
echo "==> [6/7] Creating production directory hierarchy..."
APP_DIR="/opt/hiralal"
mkdir -p "${APP_DIR}" \
  "${APP_DIR}/deployment-state" \
  "${APP_DIR}/releases" \
  "${APP_DIR}/nginx/ssl" \
  /etc/hiralal \
  /var/backups/hiralal \
  /var/log/hiralal

chmod 700 /etc/hiralal /var/backups/hiralal /var/log/hiralal

# If a non-root deployment user exists (e.g. ubuntu), grant appropriate permissions
DEPLOY_USER="${DEPLOY_USER:-ubuntu}"
if id "${DEPLOY_USER}" >/dev/null 2>&1; then
  usermod -aG docker "${DEPLOY_USER}"
  chown -R "${DEPLOY_USER}:${DEPLOY_USER}" "${APP_DIR}" /var/log/hiralal
fi

# 7. Automated Security Updates
echo "==> [7/7] Enabling unattended automated security updates..."
systemctl enable unattended-upgrades
systemctl start unattended-upgrades

echo "========================================================================"
echo "Hostinger KVM 2 Production Server Hardening COMPLETE!"
echo "- Target: Ubuntu 24.04/22.04 LTS (x86_64)"
echo "- Firewall: UFW enabled (Ports 22, 80, 443 permitted; internal ports denied)"
echo "- Fail2ban: Active on SSH"
echo "- Docker: Installed with Compose plugin"
echo "- Application Directory: /opt/hiralal"
echo "========================================================================"
