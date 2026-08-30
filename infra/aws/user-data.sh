#!/bin/bash
# ============================================================================
# user-data.sh — bootstrap da EC2 (Ubuntu 24.04 LTS, t3.small) — conta eleva
# Sem domínio: HTTP puro no IP público (Caddy no modo :80).
# ============================================================================
set -euo pipefail

exec > >(tee -a /var/log/user-data.log) 2>&1
export DEBIAN_FRONTEND=noninteractive

# 1. Swap de 2 GB
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
  echo 'vm.swappiness=20' > /etc/sysctl.d/99-swap.conf
  sysctl -p /etc/sysctl.d/99-swap.conf
fi

# 2. Docker + Compose plugin + utilitários
apt-get update -y
apt-get install -y ca-certificates curl git ufw
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" > /etc/apt/sources.list.d/docker.list
apt-get update -y
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# 3. Firewall: SSH + HTTP (HTTPS sem domínio não se aplica; liberado p/ futuro)
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

# 4. Projeto
GITHUB_REPO="https://github.com/leoelevamktt/aquaos-coach.git"
APP_DIR=/opt/natacao
mkdir -p "$APP_DIR"
cd "$APP_DIR"
if [ -d .git ]; then
  git pull --ff-only
else
  git clone --depth 1 "$GITHUB_REPO" .
fi

# 5. Env de produção — preenchido com os valores reais do deploy
PUBLIC_IP=$(curl -fsS http://169.254.169.254/latest/meta-data/public-ipv4 || true)
cat > .env <<EOF
POSTGRES_PASSWORD=5b67485e349798ef7ff1fed352ee09b8
CORS_ORIGINS=http://\${PUBLIC_IP}
PUBLIC_API_URL=http://\${PUBLIC_IP}
EOF

# 6. Caddyfile em modo HTTP puro (sem domínio)
sed -i 's/^SEU_DOMINIO {/:80 {/; s|^# :80 {|# SEU_DOMINIO {|' infra/Caddyfile

# 7. Build + start — em background: o build completo passa do timeout do
#    user-data; o log continua em /var/log/user-data.log
nohup docker compose -f docker-compose.aws.yml up -d --build >> /var/log/user-data.log 2>&1 &

echo "Bootstrap assíncrono iniciado em $(date -u +%Y-%m-%dT%H:%M:%SZ)"
