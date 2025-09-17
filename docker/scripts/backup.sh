#!/bin/bash
# docker/scripts/backup.sh
# Script simple de backup para datos de n8n

set -e

BACKUP_DIR="/home/ec2-user/backups"
N8N_DATA_DIR="/home/ec2-user/n8n/data"
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="n8n_backup_$DATE.tar.gz"

echo "💾 Creating backup of n8n data..."

# Create backup directory
mkdir -p $BACKUP_DIR

# Stop n8n temporarily
cd /home/ec2-user/n8n
docker-compose stop n8n

# Create backup
tar -czf $BACKUP_DIR/$BACKUP_FILE -C $(dirname $N8N_DATA_DIR) $(basename $N8N_DATA_DIR)

# Start n8n again
docker-compose start n8n

echo "✅ Backup created: $BACKUP_DIR/$BACKUP_FILE"
echo "📊 Backup size: $(ls -lh $BACKUP_DIR/$BACKUP_FILE | awk '{print $5}')"

# Keep only last 7 backups
find $BACKUP_DIR -name "n8n_backup_*.tar.gz" -type f -mtime +7 -delete

echo "🧹 Old backups cleaned up (keeping last 7 days)"
