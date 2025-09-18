import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as efs from 'aws-cdk-lib/aws-efs';  // ← ESTE IMPORT FALTA
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';


export class N8nStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const domainName = process.env.DOMAIN_NAME || 'n8n.aws.yyogestiono.com';
    const baseDomain = 'aws.yyogestiono.com';

    // Lookup existing hosted zone
    const hostedZone = route53.HostedZone.fromLookup(this, 'HostedZone', {
      domainName: baseDomain
    });

    // Create VPC
    const vpc = new ec2.Vpc(this, 'N8nVpc', {
      maxAzs: 1,
      natGateways: 0,
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: 'public',
          subnetType: ec2.SubnetType.PUBLIC,
        }
      ]
    });
    // Security Group for EFS
    const efsSecurityGroup = new ec2.SecurityGroup(this, 'EfsSecurityGroup', {
      vpc,
      description: 'Security group for EFS',
      allowAllOutbound: false
    });

    // Create EFS for persistent storage ← ESTO ES NUEVO
    const fileSystem = new efs.FileSystem(this, 'N8nEFS', {
      vpc: vpc,
      lifecyclePolicy: efs.LifecyclePolicy.AFTER_30_DAYS,
      performanceMode: efs.PerformanceMode.GENERAL_PURPOSE,
      throughputMode: efs.ThroughputMode.BURSTING,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      securityGroup: efsSecurityGroup
    });

    // Security Group for EC2
    const securityGroup = new ec2.SecurityGroup(this, 'N8nSecurityGroup', {
      vpc,
      description: 'Security group for n8n EC2 instance',
      allowAllOutbound: true
    });


    // Allow EFS access from EC2
    efsSecurityGroup.addIngressRule(
      securityGroup,
      ec2.Port.tcp(2049),
      'Allow NFS access from EC2'
    );

    // Allow HTTPS traffic
    securityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(443),
      'Allow HTTPS traffic'
    );

    // Allow HTTP traffic
    securityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(80),
      'Allow HTTP traffic'
    );

    // Allow SSH for maintenance (optional, puede comentarse en producción)
    securityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(22),
      'Allow SSH access'
    );

    // Create EFS Access Point ← ESTO ES NUEVO
    fileSystem.addAccessPoint('N8nAccessPoint', {
        path: '/n8n-data',
        posixUser: {
            gid: '1000',
            uid: '1000'
        }
    });

    // IAM role for EC2 (ACTUALIZADO con permisos EFS)
    const ec2Role = new iam.Role(this, 'N8nEc2Role', {
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('CloudWatchAgentServerPolicy'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonElasticFileSystemClientFullAccess') // ← NUEVO
      ]
    });

    // User data script (ACTUALIZADO con montaje EFS)
    const userData = ec2.UserData.forLinux();
    userData.addCommands(
      '#!/bin/bash',
      'yum update -y',
      'yum install -y docker amazon-efs-utils', // ← AGREGADO amazon-efs-utils
      'systemctl start docker',
      'systemctl enable docker',
      'usermod -a -G docker ec2-user',
      
      // Install Docker Compose
      'curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose',
      'chmod +x /usr/local/bin/docker-compose',
      'ln -s /usr/local/bin/docker-compose /usr/bin/docker-compose',
      
      // Create and mount EFS ← ESTO ES NUEVO
      'mkdir -p /mnt/efs',
      `echo "${fileSystem.fileSystemId}.efs.us-east-1.amazonaws.com:/ /mnt/efs efs defaults,_netdev" >> /etc/fstab`,
      'mount -a',
      'mkdir -p /mnt/efs/n8n-data',
      'chown -R 1000:1000 /mnt/efs/n8n-data',
      
      // Create directories
      'mkdir -p /home/ec2-user/n8n',
      'mkdir -p /home/ec2-user/n8n/nginx',
      'mkdir -p /home/ec2-user/n8n/certbot/www',
      'mkdir -p /home/ec2-user/n8n/certbot/conf',
      
      // Set permissions
      'chown -R ec2-user:ec2-user /home/ec2-user/n8n',
      
      // Create docker-compose.yml with EFS mount ← ACTUALIZADO
      `cat > /home/ec2-user/n8n/docker-compose.yml << 'EOF'
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
    command: '/bin/sh -c ''while :; do sleep 6h & wait $$!; nginx -s reload; done & nginx -g "daemon off;"'''

  n8n:
    image: n8nio/n8n:latest
    container_name: n8n-app
    environment:
      - N8N_HOST=\${DOMAIN_NAME}
      - N8N_PORT=5678
      - N8N_PROTOCOL=https
      - WEBHOOK_URL=https://\${DOMAIN_NAME}
      - GENERIC_TIMEZONE=America/Mexico_City
      - DB_TYPE=sqlite
      - DB_SQLITE_DATABASE=/home/node/.n8n/database.sqlite
      - N8N_LOG_LEVEL=info
      - DB_TYPE=sqlite      
    volumes:
      - /mnt/efs/n8n-data:/home/node/.n8n  # ← CAMBIADO A EFS
    expose:
      - "5678"
    restart: unless-stopped
    user: "1000:1000"

  certbot:
    image: certbot/certbot
    container_name: n8n-certbot
    volumes:
      - ./certbot/conf:/etc/letsencrypt:rw
      - ./certbot/www:/var/www/certbot:rw
    entrypoint: "/bin/sh -c 'trap exit TERM; while :; do certbot renew; sleep 12h & wait $$!; done;'"
EOF`,
      
      // Create nginx configuration
      `cat > /home/ec2-user/n8n/nginx/nginx.conf << 'EOF'
events {
    worker_connections 1024;
}

http {
    upstream n8n {
        server n8n:5678;
    }

    server {
        listen 80;
        server_name ${domainName};
        
        location /.well-known/acme-challenge/ {
            root /var/www/certbot;
        }
        
        location / {
            return 301 https://\\$host\\$request_uri;
        }
    }

    server {
        listen 443 ssl;
        http2 on;
        server_name ${domainName};

        ssl_certificate /etc/letsencrypt/live/${domainName}/fullchain.pem;
        ssl_certificate_key /etc/letsencrypt/live/${domainName}/privkey.pem;
        
        ssl_protocols TLSv1.2 TLSv1.3;
        ssl_ciphers ECDHE-RSA-AES256-GCM-SHA512:DHE-RSA-AES256-GCM-SHA512:ECDHE-RSA-AES256-GCM-SHA384:DHE-RSA-AES256-GCM-SHA384;
        ssl_prefer_server_ciphers off;

        location / {
            proxy_pass http://n8n;
            proxy_set_header Host \\$host;
            proxy_set_header X-Real-IP \\$remote_addr;
            proxy_set_header X-Forwarded-For \\$proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto \\$scheme;
            
            # WebSocket support for n8n
            proxy_http_version 1.1;
            proxy_set_header Upgrade \\$http_upgrade;
            proxy_set_header Connection "upgrade";
            
            # Timeouts
            proxy_connect_timeout 60s;
            proxy_send_timeout 60s;
            proxy_read_timeout 60s;
        }
    }
}
EOF`,
      
      // Create initial certificate script
      `cat > /home/ec2-user/n8n/init-cert.sh << 'EOF'
#!/bin/bash
DOMAIN_NAME="${domainName}"
EMAIL="admin@yyogestiono.com"

# Create temporary nginx config for initial setup
cat > /home/ec2-user/n8n/nginx/nginx-init.conf << 'NGINX_EOF'
events {
    worker_connections 1024;
}
http {
    server {
        listen 80;
        server_name DOMAIN_PLACEHOLDER;
        location /.well-known/acme-challenge/ {
            root /var/www/certbot;
        }
        location / {
            return 200 'OK';
            add_header Content-Type text/plain;
        }
    }
}
NGINX_EOF

sed -i "s/DOMAIN_PLACEHOLDER/$DOMAIN_NAME/g" /home/ec2-user/n8n/nginx/nginx-init.conf

# Start nginx with initial config
docker run -d --name nginx-init -p 80:80 \
  -v /home/ec2-user/n8n/nginx/nginx-init.conf:/etc/nginx/nginx.conf:ro \
  -v /home/ec2-user/n8n/certbot/www:/var/www/certbot:rw \
  nginx:alpine

# Wait a moment for nginx to start
sleep 10

# Get initial certificate
docker run --rm \
  -v /home/ec2-user/n8n/certbot/conf:/etc/letsencrypt:rw \
  -v /home/ec2-user/n8n/certbot/www:/var/www/certbot:rw \
  certbot/certbot \
  certonly --webroot --webroot-path=/var/www/certbot \
  --email $EMAIL --agree-tos --no-eff-email \
  -d $DOMAIN_NAME

# Stop initial nginx
docker stop nginx-init
docker rm nginx-init

# Start the full stack
cd /home/ec2-user/n8n
DOMAIN_NAME=$DOMAIN_NAME docker-compose up -d

echo "Setup completed! Check status with: docker-compose logs"
EOF`,
      
      'chmod +x /home/ec2-user/n8n/init-cert.sh',
      
      // Set environment variable and run setup
      `echo "export DOMAIN_NAME=${domainName}" >> /home/ec2-user/.bashrc`,
      `su - ec2-user -c "cd /home/ec2-user/n8n && DOMAIN_NAME=${domainName} ./init-cert.sh"`
    );

    // Create Keypair
    const key = new ec2.CfnKeyPair(this, 'N8nKey', {
      keyName: 'n8n-key',
    });

    // Key pair (necesitas crear uno en la consola AWS o usar uno existente)
    const keyName = 'n8n-key'; // Asegúrate de crear esta key pair en AWS Console


    // EC2 Instance
    const instance = new ec2.Instance(this, 'N8nInstance', {
      vpc,
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.NANO),
      machineImage: ec2.MachineImage.latestAmazonLinux2023(),
      keyName: keyName,
      securityGroup: securityGroup,
      role: ec2Role,
      userData: userData,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PUBLIC
      }
    });

    // Elastic IP
    const eip = new ec2.CfnEIP(this, 'N8nEIP', {
      instanceId: instance.instanceId,
      domain: 'vpc'
    });

    // Route53 A Record
    new route53.ARecord(this, 'N8nARecord', {
      zone: hostedZone,
      recordName: 'n8n',
      target: route53.RecordTarget.fromIpAddresses(eip.ref)
    });

    // Outputs
    new cdk.CfnOutput(this, 'InstanceId', {
      value: instance.instanceId,
      description: 'EC2 Instance ID'
    });

    new cdk.CfnOutput(this, 'PublicIP', {
      value: eip.ref,
      description: 'Elastic IP address'
    });

    new cdk.CfnOutput(this, 'N8nUrl', {
      value: `https://${domainName}`,
      description: 'n8n Application URL'
    });

    new cdk.CfnOutput(this, 'SSHCommand', {
      value: `ssh -i ~/.ssh/${keyName}.pem ec2-user@${eip.ref}`,
      description: 'SSH command to connect to the instance'
    });
  }
}