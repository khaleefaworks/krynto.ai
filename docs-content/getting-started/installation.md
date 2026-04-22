# Production Installation

This guide covers deploying AI ChatAssist on a Linux server (Ubuntu 22.04 recommended) with Nginx, systemd, and PostgreSQL.

## Architecture

```
Internet → Nginx (SSL termination)
               ├── api.yourdomain.com  → Gunicorn/Uvicorn (FastAPI backend)
               └── chat.yourdomain.com → Static files (React frontend build)
```

## Server requirements

| Resource | Minimum | Recommended |
|----------|---------|-------------|
| CPU | 1 vCPU | 2 vCPU |
| RAM | 1 GB | 2 GB |
| Disk | 20 GB | 40 GB |
| OS | Ubuntu 22.04 | Ubuntu 22.04 |

## 1. Install system dependencies

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y git python3 python3-venv python3-pip nodejs npm nginx postgresql redis-server certbot python3-certbot-nginx
```

## 2. PostgreSQL setup

```bash
sudo -u postgres psql
```
```sql
CREATE DATABASE aichatassist;
CREATE USER aichatassist WITH PASSWORD 'strong-password-here';
GRANT ALL PRIVILEGES ON DATABASE aichatassist TO aichatassist;
\q
```

## 3. Clone and configure

```bash
cd /opt
sudo git clone <your-repo-url> ai-chatassist
sudo chown -R $USER:$USER /opt/ai-chatassist
```

### Backend environment

```bash
cd /opt/ai-chatassist/backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

cp deploy/systemd/aichatassist-backend.env.example .env
# Edit .env — set all required values (see table below)
```

Key environment variables:

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | `postgresql://aichatassist:password@localhost/aichatassist` |
| `SECRET_KEY` | Long random string — `openssl rand -hex 32` |
| `FRONTEND_URL` | `https://chat.yourdomain.com` |
| `BACKEND_URL` | `https://api.yourdomain.com` |
| `REDIS_URL` | `redis://localhost:6379` |
| `ALLOWED_ORIGINS` | Comma-separated list of allowed origins |
| `RESEND_API_KEY` | (optional) for email |
| `VAPID_PUBLIC_KEY` | (optional) for push notifications |
| `VAPID_PRIVATE_KEY` | (optional) for push notifications |

### Run migrations

```bash
alembic upgrade head
```

## 4. Frontend build

```bash
cd /opt/ai-chatassist/frontend
npm install
VITE_API_BASE=https://api.yourdomain.com npm run build
# Output: frontend/dist/
```

## 5. Nginx

Copy config files from `deploy/nginx/` and update domain names:

```bash
sudo cp deploy/nginx/api.example.com.conf /etc/nginx/sites-available/api.yourdomain.com.conf
sudo cp deploy/nginx/dashboard.example.com.conf /etc/nginx/sites-available/chat.yourdomain.com.conf
# Edit both files — replace example.com with your domain
sudo ln -s /etc/nginx/sites-available/api.yourdomain.com.conf /etc/nginx/sites-enabled/
sudo ln -s /etc/nginx/sites-available/chat.yourdomain.com.conf /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

## 6. SSL certificates

```bash
sudo certbot --nginx -d api.yourdomain.com -d chat.yourdomain.com
```

## 7. Systemd service

```bash
sudo cp deploy/systemd/aichatassist-backend.service /etc/systemd/system/
# Edit the service file — update paths and user
sudo systemctl daemon-reload
sudo systemctl enable --now aichatassist-backend
sudo systemctl status aichatassist-backend
```

## 8. Backups

```bash
sudo cp deploy/systemd/aichatassist-backup.service /etc/systemd/system/
sudo cp deploy/systemd/aichatassist-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now aichatassist-backup.timer
```

## Verify

```bash
curl https://api.yourdomain.com/health
# {"status": "ok"}
```
