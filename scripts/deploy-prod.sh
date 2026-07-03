#!/bin/bash
set -e

PROD_DIR="${PROD_DIR:-/volume1/docker/dujia-tiku}"

echo ">>> Deploying production environment"
cd "$PROD_DIR"

# Backup database before deployment
BACKUP_NAME="data/du-tiku.db.backup.$(date +%Y%m%d%H%M%S)"
cp data/du-tiku.db "$BACKUP_NAME"
echo ">>> Database backed up to $BACKUP_NAME"

# Pull latest code
git pull --ff-only origin main

# Rebuild and restart
/usr/local/bin/docker compose down
/usr/local/bin/docker compose up -d --build

echo ">>> Production deployment complete at the HOST_PORT configured in .env"
