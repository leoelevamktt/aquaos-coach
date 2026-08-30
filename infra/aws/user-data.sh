#!/bin/bash
# ============================================================================
# user-data.sh — bootstrap da EC2 (Ubuntu 24.04 LTS, t3.small)
# Executa automaticamente no primeiro boot da instância.
# Substitua GITHUB_REPO abaixo pelo repositório real do projeto.
# ============================================================================
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive

# 1. Swap de 2 GB (essencial para picos de FFmpeg/build em 2 GB de RAM)
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
  # Menos agressivo: container é prioridade sobre cache de disco
  echo 'vm.swappiness=20' > /etc/sysctl.d/99-swap.conf
  sysctl -p /etc/sysctl.d/99-swap.conf
fi

# 2. Docker + Compose plugin
apt-get update -y
apt-get install -y ca-certificates curl git ufw
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" > /etc/apt/sources.list.d/docker.list
apt-get update -y
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# 3. Firewall: SSH + HTTP + HTTPS (Postgres fica só no localhost da VM)
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

# 4. Projeto
GITHUB_REPO="https://github.com/SEU-USUARIO/SEU-REPO.git"
APP_DIR=/opt/natacao
mkdir -p "$APP_DIR"
cd "$APP_DIR"
if [ -d .git ]; then
  git pull --ff-only
else
  git clone --depth 1 "$GITHUB_REPO" .
fi

# 5. Env de produção (defina os valores reais antes de lançar a instância,
#    ou provisione via Secrets Manager/SSM Parameter Store e leia aqui)
cat > .env <<'EOF'
# POSTGRES_PASSWORD: gere com `openssl rand -hex 16`
POSTGRES_PASSWORD=ALTERE-ME
# Domínio público do app (com https://) — usado no CORS da API
CORS_ORIGINS=https://ALTERE-ME
# URL pública da API — injetada no build do Next.js
PUBLIC_API_URL=https://ALTERE-ME
EOF

# 6. Build + start (bloqueia até terminar; user-data tem timeout de ~15 min,
#    build do Next.js em t3.small pode demorar ~8 min; se estourar, rode
#    manualmente via SSH: docker compose -f docker-compose.aws.yml up -d --build)
docker compose -f docker-compose.aws.yml up -d --build || true

# 7. Watchtower desligado: updates são manuais via git pull + compose up
echo "Bootstrap concluído em $(date -u +%Y-%m-%dT%H:%M:%SZ)" >> /var/log/user-data.log
