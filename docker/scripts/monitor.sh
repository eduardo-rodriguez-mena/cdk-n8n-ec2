#!/bin/bash
# docker/scripts/monitor.sh
# Script de monitoreo básico

cd /home/ec2-user/n8n

echo "📊 n8n System Status"
echo "==================="
echo ""

echo "🐳 Docker Containers:"
docker-compose ps
echo ""

echo "💾 Disk Usage:"
df -h /home/ec2-user/n8n
echo ""

echo "🔧 Service Health:"
if curl -f https://n8n.aws.yyogestiono.com/healthz >/dev/null 2>&1; then
    echo "✅ n8n is responding"
else
    echo "❌ n8n is not responding"
fi
echo ""

echo "📜 Recent Logs (last 20 lines):"
docker-compose logs --tail=20