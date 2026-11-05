#!/usr/bin/env bash
# Deploys talkingwithmyself-agent code to the Raspberry Pi.
# Usage: ./deploy/deploy-pi.sh [PI_HOST]
set -euo pipefail

PI_HOST="${1:-chch@raspberrypi.local}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "==> Sincronizando código a ${PI_HOST}:/tmp/twm-agent…"
rsync -avz --delete \
  --exclude '.git' \
  --exclude 'data' \
  --exclude 'models' \
  --exclude 'samples' \
  --exclude 'node_modules' \
  --exclude '.env*' \
  "${ROOT}/" "${PI_HOST}:/tmp/twm-agent/"

echo "==> Desplegando en /var/lib/twm/agent…"
ssh -t "${PI_HOST}" "
  sudo rsync -a --delete --exclude node_modules --chown=twm:twm /tmp/twm-agent/ /var/lib/twm/agent/ &&
  rm -rf /tmp/twm-agent &&
  sudo -u twm bash -c 'cd /var/lib/twm/agent && npm ci --omit=dev' &&
  sudo cp /var/lib/twm/agent/deploy/twm.service /etc/systemd/system/twm.service &&
  sudo cp /var/lib/twm/agent/deploy/twm-cleanup.service /etc/systemd/system/twm-cleanup.service &&
  sudo cp /var/lib/twm/agent/deploy/twm-cleanup.timer /etc/systemd/system/twm-cleanup.timer &&
  sudo systemctl daemon-reload &&
  sudo systemctl enable --now twm-cleanup.timer &&
  if ! sudo test -d /var/lib/twm/blog/.git; then
    echo '==> Clonando repositorio del blog en /var/lib/twm/blog…'
    sudo -u twm git clone https://github.com/JesusCabreraReveles/cabrera-systems-blog.git /var/lib/twm/blog
  else
    echo '==> Actualizando repositorio del blog en /var/lib/twm/blog…'
    sudo -u twm git -C /var/lib/twm/blog pull origin master
  fi &&
  sudo mkdir -p /var/lib/twm/data &&
  sudo chown -R twm:twm /var/lib/twm/data /var/lib/twm/blog &&
  if systemctl is-active --quiet twm.service; then
    echo '==> Reiniciando servicio twm.service…'
    sudo systemctl restart twm.service
  fi
"

echo "==> Despliegue completado con éxito."
