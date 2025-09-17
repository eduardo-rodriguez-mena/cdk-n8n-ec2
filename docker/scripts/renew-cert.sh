#!/bin/bash
# docker/scripts/renew-cert.sh
# Script para renovar certificados SSL automáticamente

set -e

DOMAIN_NAME="${DOMAIN_NAME:-n8n.aws.yyogestiono.com}"
cd /home/ec2-user/n8n

echo "🔄 Renewing SSL certificate for $DOMAIN_NAME..."

# Renew certificate
docker-compose exec certbot certbot renew --quiet

# Reload nginx to use new certificate
docker-compose exec nginx nginx -s reload

echo "✅ Certificate renewal completed!"

# Check certificate expiration
echo "📋 Certificate status:"
docker-compose exec certbot certbot certificates
