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
  cd /var/lib/twm/agent &&
  sudo -u twm npm ci --omit=dev &&
  if systemctl is-active --quiet twm.service; then
    echo '==> Reiniciando servicio twm.service…'
    sudo systemctl restart twm.service
  fi
"

echo "==> Despliegue completado con éxito."
