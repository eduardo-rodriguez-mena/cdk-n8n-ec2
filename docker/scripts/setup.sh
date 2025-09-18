#!/bin/bash
# docker/scripts/setup.sh
# Script para configuración inicial completa del servidor

set -e

DOMAIN_NAME="${DOMAIN_NAME:-n8n.aws.yyogestiono.com}"
EMAIL="${EMAIL:-admin@yyogestiono.com}"
N8N_USER="${N8N_BASIC_AUTH_USER:-admin}"
N8N_PASSWORD="${N8N_BASIC_AUTH_PASSWORD:-changeme123!}"

echo "🚀 Starting n8n setup for domain: $DOMAIN_NAME"

# Create directory structure
echo "📁 Creating directories..."
mkdir -p /home/ec2-user/n8n/{data,nginx,certbot/{www,conf},scripts}
cd /home/ec2-user/n8n

# Create docker-compose.yml with environment variables
echo "🐳 Creating docker-compose.yml..."
cat > docker-compose.yml << EOF

services:
  nginx:
    image: nginx:alpine
    container_name: n8n-nginx
    ports:
      - "443:443"
      - "80:80"
    volumes:
      - ./nginx/nginx.conf:/etc/nginx/nginx.conf:ro
      - ./certbot/conf:/etc/letsencrypt:ro
      - ./certbot/www:/var/www/certbot:ro
    depends_on:
      - n8n
    restart: unless-stopped
    command: '/bin/sh -c ''while :; do sleep 6h & wait \$\$!; nginx -s reload; done & nginx -g "daemon off;"'''

  n8n:
    image: n8nio/n8n:latest
    container_name: n8n-app
    environment:
      - N8N_HOST=$DOMAIN_NAME
      - N8N_PORT=5678
      - N8N_PROTOCOL=https
      - WEBHOOK_URL=https://$DOMAIN_NAME
      - GENERIC_TIMEZONE=America/Mexico_City
      - N8N_LOG_LEVEL=info
      - DB_TYPE=sqlite
      - DB_SQLITE_DATABASE=/home/node/.n8n/database.sqlite
      - N8N_LOG_LEVEL=info
      - DB_TYPE=sqlite      
      - N8N_BASIC_AUTH_ACTIVE=true
      - N8N_BASIC_AUTH_USER=$N8N_USER
      - N8N_BASIC_AUTH_PASSWORD=$N8N_PASSWORD
    volumes:
      - ./data:/home/node/.n8n
    expose:
      - "5678"
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "wget", "--quiet", "--tries=1", "--spider", "http://localhost:5678/healthz"]
      interval: 30s
      timeout: 10s
      retries: 3

  certbot:
    image: certbot/certbot
    container_name: n8n-certbot
    volumes:
      - ./certbot/conf:/etc/letsencrypt:rw
      - ./certbot/www:/var/www/certbot:rw
    entrypoint: "/bin/sh -c 'trap exit TERM; while :; do certbot renew --quiet; sleep 12h & wait \$\$!; done;'"
    restart: unless-stopped
EOF

# Create nginx configuration with domain substitution
echo "🌐 Creating nginx configuration..."
cat > nginx/nginx.conf << EOF
events {
    worker_connections 1024;
}

http {
    sendfile on;
    tcp_nopush on;
    tcp_nodelay on;
    keepalive_timeout 65;
    types_hash_max_size 2048;
    server_tokens off;

    include /etc/nginx/mime.types;
    default_type application/octet-stream;

    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers on;
    ssl_ciphers ECDHE-RSA-AES256-GCM-SHA512:DHE-RSA-AES256-GCM-SHA512:ECDHE-RSA-AES256-GCM-SHA384:DHE-RSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-SHA384;

    log_format main '\$remote_addr - \$remote_user [\$time_local] "\$request" '
                    '\$status \$body_bytes_sent "\$http_referer" '
                    '"\$http_user_agent" "\$http_x_forwarded_for"';

    access_log /var/log/nginx/access.log main;
    error_log /var/log/nginx/error.log warn;

    gzip on;
    gzip_vary on;
    gzip_proxied any;
    gzip_comp_level 6;
    gzip_types text/plain text/css text/xml text/javascript application/json application/javascript application/xml+rss application/atom+xml;

    limit_req_zone \$binary_remote_addr zone=api:10m rate=10r/s;
    limit_req_zone \$binary_remote_addr zone=login:10m rate=1r/s;

    upstream n8n {
        server n8n:5678;
        keepalive 32;
    }

    server {
        listen 80;
        server_name $DOMAIN_NAME;
        
        location /.well-known/acme-challenge/ {
            root /var/www/certbot;
            try_files \$uri =404;
        }
        
        location / {
            return 301 https://\$host\$request_uri;
        }
    }

    server {
        listen 443 ssl;
        http2 on;
        server_name $DOMAIN_NAME;

        ssl_certificate /etc/letsencrypt/live/$DOMAIN_NAME/fullchain.pem;
        ssl_certificate_key /etc/letsencrypt/live/$DOMAIN_NAME/privkey.pem;
        
        add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
        add_header X-Frame-Options DENY always;
        add_header X-Content-Type-Options nosniff always;
        add_header X-XSS-Protection "1; mode=block" always;
        add_header Referrer-Policy "strict-origin-when-cross-origin" always;

        client_max_body_size 50M;

        location ~ ^/(rest/login|rest/forgot-password) {
            limit_req zone=login burst=5 nodelay;
            proxy_pass http://n8n;
            proxy_set_header Host \$host;
            proxy_set_header X-Real-IP \$remote_addr;
            proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto \$scheme;
        }

        location /rest/ {
            limit_req zone=api burst=20 nodelay;
            proxy_pass http://n8n;
            proxy_set_header Host \$host;
            proxy_set_header X-Real-IP \$remote_addr;
            proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto \$scheme;
        }

        location / {
            proxy_pass http://n8n;
            proxy_set_header Host \$host;
            proxy_set_header X-Real-IP \$remote_addr;
            proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto \$scheme;
            
            proxy_http_version 1.1;
            proxy_set_header Upgrade \$http_upgrade;
            proxy_set_header Connection "upgrade";
            proxy_set_header X-Forwarded-Host \$host;
            proxy_set_header X-Forwarded-Server \$host;
            
            proxy_connect_timeout 60s;
            proxy_send_timeout 60s;
            proxy_read_timeout 60s;
            
            proxy_buffering off;
            proxy_request_buffering off;
        }

        location /healthz {
            access_log off;
            proxy_pass http://n8n/healthz;
        }
    }
}
EOF

# Step 1: Start nginx with HTTP-only config for certificate generation
echo "🔧 Starting initial nginx for certificate generation..."
cat > nginx/nginx-init.conf << EOF
events {
    worker_connections 1024;
}
http {
    server {
        listen 80;
        server_name $DOMAIN_NAME;
        location /.well-known/acme-challenge/ {
            root /var/www/certbot;
        }
        location / {
            return 200 'Server is ready for SSL setup';
            add_header Content-Type text/plain;
        }
    }
}
EOF

# Start initial nginx container
docker run -d --name nginx-init -p 80:80 \
  -v $(pwd)/nginx/nginx-init.conf:/etc/nginx/nginx.conf:ro \
  -v $(pwd)/certbot/www:/var/www/certbot:rw \
  nginx:alpine

# Wait for nginx to be ready
echo "⏳ Waiting for nginx to be ready..."
sleep 10

# Test if nginx is responding
if ! curl -f http://localhost >/dev/null 2>&1; then
    echo "❌ Nginx is not responding. Check configuration."
    docker logs nginx-init
    exit 1
fi

echo "✅ Nginx is ready. Requesting SSL certificate..."

# Step 2: Request SSL certificate
docker run --rm \
  -v $(pwd)/certbot/conf:/etc/letsencrypt:rw \
  -v $(pwd)/certbot/www:/var/www/certbot:rw \
  certbot/certbot \
  certonly --webroot --webroot-path=/var/www/certbot \
  --email $EMAIL --agree-tos --no-eff-email \
  --force-renewal \
  -d $DOMAIN_NAME

if [ $? -eq 0 ]; then
    echo "✅ SSL certificate obtained successfully!"
else
    echo "❌ Failed to obtain SSL certificate. Check DNS and domain configuration."
    docker stop nginx-init
    docker rm nginx-init
    exit 1
fi

# Step 3: Stop initial nginx and start full stack
echo "🔄 Switching to full stack with SSL..."
docker stop nginx-init
docker rm nginx-init

# Set permissions
chown -R ec2-user:ec2-user /home/ec2-user/n8n

# Start the full application stack
docker-compose up -d

# Wait for services to be ready
echo "⏳ Waiting for services to start..."
sleep 30

# Check if services are running
if docker-compose ps | grep -q "Up"; then
    echo "✅ Services are running!"
    echo ""
    echo "🎉 Setup completed successfully!"
    echo "📝 Access details:"
    echo "   URL: https://$DOMAIN_NAME"
    echo "   Username: $N8N_USER"
    echo "   Password: $N8N_PASSWORD"
    echo ""
    echo "📊 Service status:"
    docker-compose ps
else
    echo "❌ Some services failed to start. Check logs:"
    docker-compose logs
    exit 1
fi