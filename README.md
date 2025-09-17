# README.md
# n8n AWS Deployment

Automated deployment of n8n workflow automation platform on AWS using CDK and GitHub Actions.

## 🏗️ Architecture

- **Compute**: EC2 t3.nano instance (512MB RAM, 1vCPU)
- **Storage**: EBS for OS + local SQLite database
- **SSL**: Let's Encrypt certificates via Certbot
- **Proxy**: Nginx reverse proxy
- **DNS**: Route53 with existing hosted zone
- **CI/CD**: GitHub Actions + AWS CDK

## 💰 Estimated Costs

- EC2 t3.nano: ~$3.76/month
- EBS 8GB: ~$0.80/month
- Route53 queries: ~$0.50/month
- **Total**: ~$5/month

## 🚀 Quick Start

### Prerequisites

1. AWS Account with programmatic access
2. Domain `aws.yyogestiono.com` configured in Route53
3. EC2 Key Pair named `n8n-key` created in us-east-1

### Setup Steps

1. **Clone and configure repository:**
   ```bash
   git clone <repository-url>
   cd n8n-aws-deployment
   ```

2. **Configure GitHub Secrets:**
   - `AWS_ACCESS_KEY_ID`: Your AWS access key
   - `AWS_SECRET_ACCESS_KEY`: Your AWS secret key
   - `DOMAIN_NAME`: `n8n.aws.yyogestiono.com`

3. **Bootstrap CDK (one-time):**
   ```bash
   cd cdk
   npm install
   npx cdk bootstrap
   ```

4. **Deploy via GitHub Actions:**
   - Push to `main` branch, or
   - Use "Actions" tab → "Deploy n8n to AWS" → "Run workflow"

### Manual Deployment

```bash
cd cdk
npm install
npm run build
cdk deploy
```

## 🔧 Post-Deployment

### Access n8n

- **URL**: https://n8n.aws.yyogestiono.com
- **Username**: `admin` (default)
- **Password**: `changeme123!` (default)

### SSH Access

```bash
ssh -i ~/.ssh/n8n-key.pem ec2-user@<ELASTIC_IP>
```

### Useful Commands

```bash
# Check services status
cd /home/ec2-user/n8n
docker-compose ps

# View logs
docker-compose logs -f

# Restart services
docker-compose restart

# Renew SSL certificate manually
./scripts/renew-cert.sh

# Create backup
./scripts/backup.sh

# Monitor system
./scripts/monitor.sh
```

## 🛠️ Troubleshooting

### SSL Certificate Issues

If SSL certificate fails to generate:

```bash
ssh -i ~/.ssh/n8n-key.pem ec2-user@<ELASTIC_IP>
cd /home/ec2-user/n8n
sudo ./scripts/setup.sh
```

### Service Not Starting

Check logs and restart:

```bash
docker-compose logs n8n
docker-compose restart n8n
```

### DNS Issues

Verify DNS propagation:

```bash
nslookup n8n.aws.yyogestiono.com
```

## 📁 Project Structure

```
n8n-aws-deployment/
├── .github/workflows/deploy.yml    # GitHub Actions workflow
├── cdk/                           # AWS CDK infrastructure
│   ├── bin/app.ts                 # CDK app entry point
│   ├── lib/n8n-stack.ts          # Main stack definition
│   ├── package.json               # CDK dependencies
│   └── tsconfig.json              # TypeScript config
├── docker/                        # Docker configurations
│   ├── docker-compose.yml         # Multi-container setup
│   ├── nginx/nginx.conf           # Nginx reverse proxy config
│   └── scripts/                   # Utility scripts
│       ├── setup.sh               # Initial setup
│       ├── renew-cert.sh          # Certificate renewal
│       ├── backup.sh              # Data backup
│       └── monitor.sh             # System monitoring
├── .gitignore                     # Git ignore rules
└── README.md                      # This file
```

## 🔐 Security Considerations

- EC2 instance in public subnet (cost optimization)
- Security Group restricts access to ports 80, 443, 22
- SSL/TLS encryption via Let's Encrypt
- Rate limiting on nginx
- Basic authentication on n8n
- Regular security updates via user data script

## 🔄 Maintenance

### Automatic
- SSL certificates renew every 12 hours via certbot container
- Nginx reloads every 6 hours to pick up new certificates
- Docker containers restart automatically on failure

### Manual
- OS updates: `sudo yum update` via SSH
- Docker image updates: `docker-compose pull && docker-compose up -d`
- Backup data: run `./scripts/backup.sh`

## 🚨 Important Notes

1. **Change default credentials** after first login
2. **Key pair** must exist in AWS Console before deployment
3. **DNS** must be properly configured in Route53
4. **Budget alerts** recommended for cost monitoring
5. **Backup strategy** should be implemented for production use

## 📞 Support

For issues:
1. Check GitHub Actions logs
2. SSH to instance and check `docker-compose logs`
3. Verify DNS resolution and certificate status
4. Review CloudFormation stack events in AWS Console
