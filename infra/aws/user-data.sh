#!/bin/bash
# ============================================================================
# user-data.sh — bootstrap da EC2 (Ubuntu 24.04 LTS, t3.small) — conta eleva
# HTTPS automático por domínio, sem credenciais versionadas.
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
apt-get install -y ca-certificates curl git ufw openssl
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" > /etc/apt/sources.list.d/docker.list
apt-get update -y
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# 3. Firewall: SSH + HTTP/HTTPS
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

# 5. Env de produção — criado uma única vez, com permissão restrita.
# Segredos opcionais (LLM e contas iniciais) devem ser injetados por um cofre
# de segredos ou incluídos manualmente no .env protegido antes de iniciar.
if [ ! -f .env ]; then
  umask 077
  DB_PASSWORD="$(openssl rand -hex 32)"
  cat > .env <<EOF
POSTGRES_PASSWORD=${DB_PASSWORD}
APP_DOMAIN=natacao.elevamkt.digital
APP_BASE_URL=https://natacao.elevamkt.digital
CORS_ORIGINS=https://natacao.elevamkt.digital
PUBLIC_API_URL=https://natacao.elevamkt.digital
EOF
fi
chmod 600 .env

# 6. Build + start — em background: o build completo passa do timeout do
# user-data; o log continua em /var/log/user-data.log
nohup docker compose -f docker-compose.aws.yml up -d --build >> /var/log/user-data.log 2>&1 &

echo "Bootstrap assíncrono iniciado em $(date -u +%Y-%m-%dT%H:%M:%SZ)"
