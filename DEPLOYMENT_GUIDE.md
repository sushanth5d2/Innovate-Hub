# Innovate Hub — Cloud Deployment Guide

Deploy the full stack (Node.js + PostgreSQL + Redis + ML Service + Nginx) on any cloud provider.

---

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [Prerequisites](#prerequisites)
- [Quick Deploy with Docker Compose](#quick-deploy-with-docker-compose)
- [AWS Deployment](#aws-deployment)
- [Azure Deployment](#azure-deployment)
- [Google Cloud Deployment](#google-cloud-deployment)
- [DigitalOcean Deployment](#digitalocean-deployment)
- [Environment Configuration](#environment-configuration)
- [SSL/HTTPS Setup](#sslhttps-setup)
- [Firebase Push Notifications](#firebase-push-notifications)
- [Monitoring & Logs](#monitoring--logs)
- [Backup & Restore](#backup--restore)
- [Scaling](#scaling)

---

## Architecture Overview

```
                    ┌─────────┐
                    │  Nginx  │ :80/:443
                    │  Proxy  │
                    └────┬────┘
                         │
              ┌──────────┼──────────┐
              │          │          │
         ┌────▼───┐ ┌───▼───┐ ┌───▼────┐
         │ Node.js│ │Socket │ │ ML Svc │
         │  API   │ │  .IO  │ │ Flask  │
         │ :3000  │ │  WS   │ │ :5000  │
         └───┬────┘ └───────┘ └────────┘
             │
     ┌───────┼───────┐
     │       │       │
 ┌───▼──┐ ┌─▼───┐ ┌─▼──────┐
 │Postgres│ │Redis│ │Uploads │
 │ :5432 │ │:6379│ │ Volume │
 └───────┘ └─────┘ └────────┘
```

| Service | Port | Required |
|---------|------|----------|
| Node.js Backend | 3000 | Yes |
| PostgreSQL 16 | 5432 | Yes (production) |
| Redis 7 | 6379 | Recommended |
| ML Service (Flask) | 5000 | Optional |
| Nginx | 80/443 | Recommended |

---

## Prerequisites

- Docker & Docker Compose installed on the server
- A domain name (for SSL)
- At minimum: **2 vCPU, 2GB RAM, 20GB disk**

### Recommended Server Specs

| Users | vCPU | RAM | Disk |
|-------|------|-----|------|
| < 100 | 2 | 2 GB | 20 GB |
| 100–1000 | 4 | 4 GB | 50 GB |
| 1000+ | 8+ | 8 GB+ | 100 GB+ |

---

## Quick Deploy with Docker Compose

This works on **any** Linux server (AWS EC2, Azure VM, GCP Compute, DigitalOcean Droplet, etc.).

### 1. Clone and configure

```bash
# Clone the repo
git clone https://github.com/sushanth5d2/Innovate-Hub.git
cd Innovate-Hub

# Create production environment file
cp .env.example .env
```

### 2. Edit .env for production

```bash
nano .env
```

Set these values:

```env
NODE_ENV=production
PORT=3000

# IMPORTANT: Generate a strong secret
JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(64).toString('hex'))")

# Database (Docker Compose handles the connection)
DB_TYPE=postgresql
PG_HOST=postgres
PG_PORT=5432
PG_USER=innovate_hub
PG_PASSWORD=YOUR_STRONG_DB_PASSWORD_HERE
PG_DATABASE=innovate_hub

# Redis
REDIS_ENABLED=true
REDIS_URL=redis://redis:6379

# CORS - set to your domain
ALLOWED_ORIGINS=https://yourdomain.com

# Admin account
ADMIN_EMAIL=admin@yourdomain.com
ADMIN_PASSWORD=YOUR_STRONG_ADMIN_PASSWORD
ADMIN_USERNAME=admin

# Firebase (optional - for Android push notifications)
FIREBASE_SERVICE_ACCOUNT_PATH=/run/secrets/firebase-sa

# AI keys (optional - add whichever you use)
# GROQ_API_KEY=
# GOOGLE_AI_API_KEY=
```

### 3. Set up Firebase (optional)

If using push notifications, place your Firebase service account key:

```bash
mkdir -p config
# Copy your firebase-service-account.json to config/
```

If you don't have Firebase set up, create a placeholder so Docker doesn't error:

```bash
echo '{}' > config/firebase-service-account.json
```

### 4. Set up SSL certificates

```bash
# Install certbot
sudo apt install -y certbot

# Get certificates (replace with your domain)
sudo certbot certonly --standalone -d yourdomain.com -d www.yourdomain.com

# Copy certs to nginx directory
mkdir -p nginx/ssl
sudo cp /etc/letsencrypt/live/yourdomain.com/fullchain.pem nginx/ssl/
sudo cp /etc/letsencrypt/live/yourdomain.com/privkey.pem nginx/ssl/
sudo chmod 644 nginx/ssl/*.pem
```

Then update `nginx/nginx.conf` — uncomment the HTTPS redirect in the port 80 block:

```nginx
# Change this line:
# return 301 https://$server_name$request_uri;
# To:
return 301 https://$server_name$request_uri;
```

### 5. Deploy

```bash
docker compose up --build -d
```

### 6. Verify

```bash
# Check all services are running
docker compose ps

# Check logs
docker compose logs -f app

# Test health endpoint
curl http://localhost:3000/
```

### 7. Auto-renewal for SSL

```bash
# Add to crontab
(crontab -l 2>/dev/null; echo "0 3 * * * certbot renew --quiet && cp /etc/letsencrypt/live/yourdomain.com/fullchain.pem /path/to/Innovate-Hub/nginx/ssl/ && cp /etc/letsencrypt/live/yourdomain.com/privkey.pem /path/to/Innovate-Hub/nginx/ssl/ && docker compose restart nginx") | crontab -
```

---

## AWS Deployment

### Option A: EC2 + Docker Compose (Simple)

1. **Launch EC2 instance:**
   - AMI: Ubuntu 24.04 LTS
   - Instance type: t3.medium (2 vCPU, 4 GB RAM)
   - Storage: 30 GB gp3
   - Security Group: Allow ports 22 (SSH), 80 (HTTP), 443 (HTTPS)

2. **SSH into instance and install Docker:**
   ```bash
   ssh -i your-key.pem ubuntu@your-ec2-ip

   # Install Docker
   curl -fsSL https://get.docker.com | sh
   sudo usermod -aG docker ubuntu
   newgrp docker

   # Install Docker Compose
   sudo apt install -y docker-compose-plugin
   ```

3. **Follow [Quick Deploy](#quick-deploy-with-docker-compose) steps above.**

4. **Attach Elastic IP** for a static public IP.

5. **Point your domain's A record** to the Elastic IP.

### Option B: AWS ECS (Managed Containers)

For higher availability, use ECS with Fargate:

1. Push Docker image to **ECR**:
   ```bash
   aws ecr create-repository --repository-name innovate-hub
   aws ecr get-login-password | docker login --username AWS --password-stdin YOUR_ACCOUNT.dkr.ecr.REGION.amazonaws.com

   docker build -t innovate-hub .
   docker tag innovate-hub:latest YOUR_ACCOUNT.dkr.ecr.REGION.amazonaws.com/innovate-hub:latest
   docker push YOUR_ACCOUNT.dkr.ecr.REGION.amazonaws.com/innovate-hub:latest
   ```

2. Use **RDS for PostgreSQL** (db.t3.micro for small deployments).

3. Use **ElastiCache for Redis** (cache.t3.micro).

4. Create an **ECS Cluster** with Fargate, define Task Definition with the ECR image.

5. Use **Application Load Balancer** with ACM certificate for SSL.

### Option C: AWS Lightsail (Cheapest)

1. Create a Lightsail instance ($10/month — 2 GB RAM, 1 vCPU)
2. SSH in, install Docker, follow Quick Deploy steps
3. Attach a static IP and point your domain

---

## Azure Deployment

### Option A: Azure VM + Docker Compose (Simple)

1. **Create a VM:**
   ```bash
   az vm create \
     --resource-group innovate-hub-rg \
     --name innovate-hub-vm \
     --image Ubuntu2404 \
     --size Standard_B2s \
     --admin-username azureuser \
     --generate-ssh-keys
   ```

2. **Open ports:**
   ```bash
   az vm open-port --resource-group innovate-hub-rg --name innovate-hub-vm --port 80,443
   ```

3. **SSH in, install Docker, follow [Quick Deploy](#quick-deploy-with-docker-compose) steps.**

### Option B: Azure Container Apps (Managed)

1. Push image to **Azure Container Registry (ACR)**:
   ```bash
   az acr create --resource-group innovate-hub-rg --name innovatehubacr --sku Basic
   az acr login --name innovatehubacr

   docker build -t innovatehubacr.azurecr.io/innovate-hub:latest .
   docker push innovatehubacr.azurecr.io/innovate-hub:latest
   ```

2. Use **Azure Database for PostgreSQL** (Flexible Server, Burstable B1ms).

3. Use **Azure Cache for Redis** (Basic C0).

4. Create **Container App** pointing to ACR image with env vars.

### Option C: Azure App Service (PaaS)

1. Create a Web App with **Node.js 20** runtime
2. Use **Deployment Center** to connect your GitHub repo
3. Set environment variables in **Configuration → Application Settings**
4. Use Azure Database for PostgreSQL as managed DB

---

## Google Cloud Deployment

### Option A: Compute Engine + Docker Compose

1. **Create VM:**
   ```bash
   gcloud compute instances create innovate-hub \
     --zone=us-central1-a \
     --machine-type=e2-medium \
     --image-family=ubuntu-2404-lts-amd64 \
     --image-project=ubuntu-os-cloud \
     --boot-disk-size=30GB
   ```

2. **Open firewall:**
   ```bash
   gcloud compute firewall-rules create allow-web --allow tcp:80,tcp:443
   ```

3. **SSH in, install Docker, follow [Quick Deploy](#quick-deploy-with-docker-compose) steps.**

### Option B: Cloud Run (Serverless)

1. Push to **Artifact Registry**:
   ```bash
   gcloud builds submit --tag gcr.io/YOUR_PROJECT/innovate-hub
   ```

2. Use **Cloud SQL for PostgreSQL** and **Memorystore for Redis**.

3. Deploy to Cloud Run:
   ```bash
   gcloud run deploy innovate-hub \
     --image gcr.io/YOUR_PROJECT/innovate-hub \
     --port 3000 \
     --allow-unauthenticated \
     --set-env-vars="DB_TYPE=postgresql,PG_HOST=/cloudsql/PROJECT:REGION:INSTANCE,..."
   ```

> **Note:** Cloud Run has WebSocket limitations. For full Socket.IO support, use Compute Engine or GKE.

---

## DigitalOcean Deployment

### Droplet + Docker Compose (Recommended)

1. **Create Droplet:**
   - Image: Docker on Ubuntu (from Marketplace)
   - Size: Basic $12/month (2 GB RAM, 1 vCPU)
   - Region: Choose closest to your users

2. **SSH in:**
   ```bash
   ssh root@your-droplet-ip
   ```

3. **Follow [Quick Deploy](#quick-deploy-with-docker-compose) steps.**

4. **Point domain** — add A record pointing to Droplet IP.

### App Platform (PaaS)

1. Connect GitHub repo
2. Select Docker as build type
3. Add PostgreSQL and Redis as managed add-ons
4. Set environment variables in App Settings

---

## Environment Configuration

### Production .env reference

```env
# === REQUIRED ===
NODE_ENV=production
PORT=3000
JWT_SECRET=<64-byte-hex-string>
DB_TYPE=postgresql
PG_HOST=postgres          # 'postgres' for Docker, or your managed DB host
PG_PORT=5432
PG_USER=innovate_hub
PG_PASSWORD=<strong-password>
PG_DATABASE=innovate_hub
ALLOWED_ORIGINS=https://yourdomain.com

# === RECOMMENDED ===
REDIS_ENABLED=true
REDIS_URL=redis://redis:6379   # 'redis' for Docker, or your managed Redis URL
ADMIN_EMAIL=admin@yourdomain.com
ADMIN_PASSWORD=<strong-password>
ADMIN_USERNAME=admin

# === OPTIONAL ===
PYTHON_ML_SERVICE_URL=http://ml-service:5000
FIREBASE_SERVICE_ACCOUNT_PATH=/run/secrets/firebase-sa
MAX_FILE_SIZE=10485760
LOG_LEVEL=info

# AI API keys (add whichever you use)
# GROQ_API_KEY=
# GOOGLE_AI_API_KEY=
```

### Generating a secure JWT secret

```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

### Generating a secure database password

```bash
openssl rand -base64 32
```

---

## SSL/HTTPS Setup

### Let's Encrypt (Free)

```bash
# Install certbot
sudo apt install -y certbot

# Stop nginx temporarily if running on port 80
docker compose stop nginx

# Get certificates
sudo certbot certonly --standalone -d yourdomain.com

# Copy certs
cp /etc/letsencrypt/live/yourdomain.com/fullchain.pem nginx/ssl/
cp /etc/letsencrypt/live/yourdomain.com/privkey.pem nginx/ssl/

# Restart nginx
docker compose start nginx
```

### Using Cloudflare (Alternative)

1. Add your domain to Cloudflare
2. Set SSL mode to **Full (Strict)**
3. Cloudflare handles SSL termination — no certs needed on server
4. Use Cloudflare's Origin CA to generate a cert for `nginx/ssl/`

---

## Firebase Push Notifications

Required only for Android push notifications on the APK.

1. Go to [Firebase Console](https://console.firebase.google.com)
2. Create project → Add Android app with package `com.innovatehub.app`
3. Project Settings → Service Accounts → Generate New Private Key
4. Save as `config/firebase-service-account.json`
5. Docker Compose mounts it as a secret automatically

Without Firebase, the app works normally — push notifications are just disabled.

---

## Monitoring & Logs

### View logs

```bash
# All services
docker compose logs -f

# Specific service
docker compose logs -f app
docker compose logs -f postgres
docker compose logs -f nginx
```

### Check service health

```bash
# All services status
docker compose ps

# Node.js health
curl http://localhost:3000/

# ML service health
curl http://localhost:5000/health

# PostgreSQL
docker compose exec postgres pg_isready

# Redis
docker compose exec redis redis-cli ping
```

### Disk usage

```bash
# Docker volumes
docker system df -v

# Upload directory size
docker compose exec app du -sh /app/uploads
```

---

## Backup & Restore

### Database Backup

```bash
# Backup PostgreSQL
docker compose exec postgres pg_dump -U innovate_hub innovate_hub > backup_$(date +%Y%m%d).sql

# Restore
docker compose exec -T postgres psql -U innovate_hub innovate_hub < backup_20260312.sql
```

### Automated Daily Backups

```bash
# Add to crontab
(crontab -l 2>/dev/null; echo "0 2 * * * cd /path/to/Innovate-Hub && docker compose exec -T postgres pg_dump -U innovate_hub innovate_hub | gzip > backups/db_\$(date +\%Y\%m\%d).sql.gz") | crontab -
```

### Uploads Backup

```bash
# Backup uploads volume
docker run --rm -v innovate-hub_uploads_data:/data -v $(pwd)/backups:/backup alpine tar czf /backup/uploads_$(date +%Y%m%d).tar.gz /data
```

---

## Scaling

### Horizontal Scaling (Multiple App Instances)

Update `docker-compose.yml` to run multiple app containers:

```yaml
app:
  deploy:
    replicas: 3
```

With Nginx upstream load balancing already configured, traffic distributes across replicas.

### Database Scaling

- **Read replicas**: Use PostgreSQL streaming replication
- **Connection pooling**: PG_POOL_MAX is set to 100 by default
- **Managed DB**: Use AWS RDS, Azure Database, or GCP Cloud SQL for auto-scaling

### Redis Scaling

- **Managed Redis**: Use AWS ElastiCache, Azure Cache, or GCP Memorystore
- **Redis Cluster**: For high-throughput caching

---

## Common Operations

### Update to latest version

```bash
cd /path/to/Innovate-Hub
git pull origin production
docker compose up --build -d
```

### Restart a single service

```bash
docker compose restart app
```

### Reset database (destructive)

```bash
docker compose down
docker volume rm innovate-hub_postgres_data
docker compose up -d
```

### Access PostgreSQL shell

```bash
docker compose exec postgres psql -U innovate_hub -d innovate_hub
```

### Access Redis CLI

```bash
docker compose exec redis redis-cli
```
