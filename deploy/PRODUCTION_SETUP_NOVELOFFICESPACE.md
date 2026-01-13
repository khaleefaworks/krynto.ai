# AI ChatAssist Production Deploy (novelofficespace.com)

This runbook deploys:
- Backend (FastAPI) at https://api.novelofficespace.com
- Dashboard (React/Vite static) at https://dashboard.novelofficespace.com
- Widget loader/assets served from the API domain (e.g. https://api.novelofficespace.com/widget/loader.js?key=...)

Target OS: Ubuntu Server (single machine)

Assumptions
- You control DNS for novelofficespace.com.
- The server is reachable from the public internet on ports 80/443 (or NAT port-forwarding is configured).
- Let’s Encrypt traffic is allowed through your firewall.
- PostgreSQL and Redis run on the same server.
- You want Redis enabled for multi-worker realtime delivery.
- You want Web Push notifications enabled in production.

---

## 0) DNS records

Create A records pointing to your static public IP:

- api.novelofficespace.com → YOUR_PUBLIC_IP
- dashboard.novelofficespace.com → YOUR_PUBLIC_IP

Notes
- Your customers’ sites do not need DNS changes for this; they only embed the widget script from api.novelofficespace.com.

---

## 1) Base packages

```bash
sudo apt update
sudo apt install -y \
	nginx \
	postgresql postgresql-contrib \
	redis-server \
	ufw \
	certbot python3-certbot-nginx \
	git
```

Optional (only if you will build the dashboard on the server): install Node 18+.

---

## 2) Firewall

Minimum:

```bash
sudo ufw allow 22
sudo ufw allow 80
sudo ufw allow 443
sudo ufw enable
```

Also ensure your perimeter firewall/NAT forwards 80 and 443 to this Ubuntu host.

---

## 3) Create service user

```bash
sudo adduser --system --group --home /opt/aichatassist aichatassist
```

---

## 4) Clone repo

Recommended clone location: /opt/aichatassist/ai-chatassist

```bash
sudo mkdir -p /opt/aichatassist
sudo chown -R aichatassist:aichatassist /opt/aichatassist
sudo -u aichatassist git clone https://github.com/crazy-explore-r/ai-chatassist.git /opt/aichatassist/ai-chatassist
```

Why here?
- /opt is a standard place for application code.
- Keeps your home directory clean.

---

## 5) Postgres setup

Create DB + user:

```bash
sudo -u postgres psql
```

Inside psql:

```sql
CREATE USER aichatassist WITH PASSWORD 'STRONG_PASSWORD_HERE';
CREATE DATABASE aichatassist OWNER aichatassist;
\q
```

---

## 6) Redis setup (required for multi-worker realtime)

```bash
sudo systemctl enable --now redis-server
sudo systemctl status redis-server --no-pager
```

Backend env will use:
- REDIS_URL=redis://127.0.0.1:6379/0

---

## 7) Persistent uploads (attachments/avatars/etc.)

You want uploads from both widget and dashboard. Store uploads outside the git checkout so deploys don’t delete them.

Create persistent path:

```bash
sudo mkdir -p /var/lib/aichatassist/uploads
sudo chown -R aichatassist:aichatassist /var/lib/aichatassist/uploads
```

Symlink repo uploads/ to persistent storage:

```bash
sudo -u aichatassist rm -rf /opt/aichatassist/ai-chatassist/uploads
sudo -u aichatassist ln -s /var/lib/aichatassist/uploads /opt/aichatassist/ai-chatassist/uploads
```

---

## 8) Backend Python environment

Install Python deps in a venv:

```bash
cd /opt/aichatassist/ai-chatassist/backend

python3 -m venv /opt/aichatassist/ai-chatassist/.venv
/opt/aichatassist/ai-chatassist/.venv/bin/pip install -r requirements.txt
```

---

## 9) VAPID keys (Web Push)

You need VAPID keys for Web Push notifications.

Option A (recommended): generate on your laptop

```bash
npx web-push generate-vapid-keys
```

Copy the output:
- publicKey
- privateKey

You will set:
- VAPID_PUBLIC_KEY=<publicKey>
- VAPID_PRIVATE_KEY=<privateKey>
- VAPID_SUBJECT=mailto:support@novelofficespace.com

Important
- Push in browsers requires HTTPS.

---

## 10) Backend environment file

Create:

```bash
sudo mkdir -p /etc/aichatassist
sudo nano /etc/aichatassist/backend.env
```

Paste and adjust:

```bash
ENV=production

DATABASE_URL=postgresql+psycopg2://aichatassist:STRONG_PASSWORD_HERE@127.0.0.1:5432/aichatassist

# MUST be a long random secret
SECRET_KEY=CHANGE_ME_TO_A_LONG_RANDOM_SECRET

# Comma-separated list (no '*')
CORS_ALLOWED_ORIGINS=https://dashboard.novelofficespace.com

# Used for widget snippet generation
PUBLIC_BASE_URL=https://api.novelofficespace.com

# Redis required for multi-worker websocket delivery
REDIS_URL=redis://127.0.0.1:6379/0

# Web Push (VAPID)
VAPID_PUBLIC_KEY=PASTE_PUBLIC_KEY
VAPID_PRIVATE_KEY=PASTE_PRIVATE_KEY
VAPID_SUBJECT=mailto:support@novelofficespace.com

# Optional tuning
# ACCESS_TOKEN_EXPIRE_MINUTES=1440
```

Secure permissions:

```bash
sudo chown root:root /etc/aichatassist/backend.env
sudo chmod 600 /etc/aichatassist/backend.env
```

---

## 11) Run migrations

```bash
cd /opt/aichatassist/ai-chatassist/backend

set -a
source /etc/aichatassist/backend.env
set +a

/opt/aichatassist/ai-chatassist/.venv/bin/alembic upgrade head
```

---

## 12) systemd service (backend)

Create:

```bash
sudo nano /etc/systemd/system/aichatassist-backend.service
```

Use:

```ini
[Unit]
Description=AI ChatAssist Backend (FastAPI)
After=network.target

[Service]
Type=simple

WorkingDirectory=/opt/aichatassist/ai-chatassist
EnvironmentFile=/etc/aichatassist/backend.env

# Multi-worker; Redis is enabled for cross-worker WebSocket fanout
ExecStart=/usr/bin/env PYTHONPATH=backend /opt/aichatassist/ai-chatassist/.venv/bin/gunicorn -k uvicorn.workers.UvicornWorker -w 2 -b 127.0.0.1:8000 app.main:app

Restart=on-failure
RestartSec=2

# Hardening
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=true

User=aichatassist
Group=aichatassist

[Install]
WantedBy=multi-user.target
```

Enable and start:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now aichatassist-backend
sudo systemctl status aichatassist-backend --no-pager
```

Logs:

```bash
sudo journalctl -u aichatassist-backend -f
```

---

## 13) Build dashboard (frontend)

You can build either:
- On your laptop/CI, then copy frontend/dist/ to the server
- Or on the server (requires Node 18+)

If building on the server:

```bash
cd /opt/aichatassist/ai-chatassist/frontend

npm ci

# IMPORTANT: this codebase expects VITE_API_BASE and VITE_WS_BASE
VITE_API_BASE=https://api.novelofficespace.com \
VITE_WS_BASE=wss://api.novelofficespace.com \
npm run build
```

Deploy build output:

```bash
sudo mkdir -p /var/www/aichatassist-dashboard
sudo rsync -a --delete /opt/aichatassist/ai-chatassist/frontend/dist/ /var/www/aichatassist-dashboard/
sudo chown -R www-data:www-data /var/www/aichatassist-dashboard
```

---

## 14) Nginx config

### 14.1 Backend vhost (api)

Create:

```bash
sudo nano /etc/nginx/sites-available/api.novelofficespace.com
```

Paste:

```nginx
map $http_upgrade $connection_upgrade {
	default upgrade;
	'' close;
}

upstream aichatassist_backend {
	server 127.0.0.1:8000;
}

server {
	listen 80;
	server_name api.novelofficespace.com;

	client_max_body_size 20m;

	location / {
		proxy_pass http://aichatassist_backend;
		proxy_http_version 1.1;

		proxy_set_header Host $host;
		proxy_set_header X-Real-IP $remote_addr;
		proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
		proxy_set_header X-Forwarded-Proto $scheme;

		proxy_set_header Upgrade $http_upgrade;
		proxy_set_header Connection $connection_upgrade;

		proxy_read_timeout 3600;
		proxy_send_timeout 3600;
	}
}
```

Enable:

```bash
sudo ln -sf /etc/nginx/sites-available/api.novelofficespace.com /etc/nginx/sites-enabled/api.novelofficespace.com
```

### 14.2 Dashboard vhost

Create:

```bash
sudo nano /etc/nginx/sites-available/dashboard.novelofficespace.com
```

Paste:

```nginx
server {
	listen 80;
	server_name dashboard.novelofficespace.com;

	root /var/www/aichatassist-dashboard;
	index index.html;

	location / {
		try_files $uri $uri/ /index.html;
	}

	location ~* \.(?:js|css|png|jpg|jpeg|gif|svg|ico|woff2?)$ {
		expires 30d;
		add_header Cache-Control "public, max-age=2592000, immutable";
		try_files $uri =404;
	}
}
```

Enable:

```bash
sudo ln -sf /etc/nginx/sites-available/dashboard.novelofficespace.com /etc/nginx/sites-enabled/dashboard.novelofficespace.com
```

Disable default:

```bash
sudo rm -f /etc/nginx/sites-enabled/default
```

Test and reload:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

---

## 15) TLS with Let’s Encrypt

Run certbot (nginx plugin):

```bash
sudo certbot --nginx -d api.novelofficespace.com -d dashboard.novelofficespace.com
```

If certbot fails
- Verify DNS is correct and propagated.
- Verify ports 80/443 are reachable from the internet (firewall/NAT).

---

## 16) Verify

Backend health:
- https://api.novelofficespace.com/health
- https://api.novelofficespace.com/docs

Dashboard:
- https://dashboard.novelofficespace.com

Push status (after login):
- Dashboard → Personal Settings → enable notifications
- Or call backend: /push/status and /push/test

---

## 17) First-time onboarding

1) Open https://dashboard.novelofficespace.com/login
2) Complete onboarding to create the Administrator account
3) Create a Website in Settings
4) Copy the widget snippet and embed on your customer site

---

## 18) Backups (2-year retention)

Minimum recommended
- Nightly Postgres dumps
- Nightly backup of uploads directory

Paths to back up
- Database: aichatassist
- Uploads: /var/lib/aichatassist/uploads

### Automated daily backups (systemd timer)

This repo includes a simple backup script + systemd timer you can install.

What it does
- Creates a timestamped folder under /var/backups/aichatassist/
- Writes Postgres dump to postgres.dump
- Archives uploads to uploads.tar.gz
- Rotates backups older than RETENTION_DAYS (default 30)

Install:

```bash
sudo install -m 0755 /opt/aichatassist/ai-chatassist/deploy/backup/aichatassist-backup.sh /usr/local/bin/aichatassist-backup

sudo install -m 0644 /opt/aichatassist/ai-chatassist/deploy/systemd/aichatassist-backup.service /etc/systemd/system/aichatassist-backup.service
sudo install -m 0644 /opt/aichatassist/ai-chatassist/deploy/systemd/aichatassist-backup.timer /etc/systemd/system/aichatassist-backup.timer

sudo systemctl daemon-reload
sudo systemctl enable --now aichatassist-backup.timer
sudo systemctl list-timers --all | grep aichatassist-backup || true
```

Note
- The service assumes your repo is at /opt/aichatassist/ai-chatassist. If you use a different path, edit ExecStart in the service file.
- To override defaults, you can add Environment= lines to the service file:
	- BACKEND_ENV_FILE (default /etc/aichatassist/backend.env)
	- BACKUP_ROOT (default /var/backups/aichatassist)
	- UPLOADS_DIR (default /var/lib/aichatassist/uploads)
	- RETENTION_DAYS (default 30)

---

## 19) Update / deploy new versions

Typical safe flow

```bash
sudo systemctl stop aichatassist-backend

cd /opt/aichatassist/ai-chatassist
sudo -u aichatassist git pull

/opt/aichatassist/ai-chatassist/.venv/bin/pip install -r backend/requirements.txt

cd /opt/aichatassist/ai-chatassist/backend
set -a
source /etc/aichatassist/backend.env
set +a
/opt/aichatassist/ai-chatassist/.venv/bin/alembic upgrade head

# Rebuild and deploy dashboard
cd /opt/aichatassist/ai-chatassist/frontend
npm ci
VITE_API_BASE=https://api.novelofficespace.com VITE_WS_BASE=wss://api.novelofficespace.com npm run build
sudo rsync -a --delete /opt/aichatassist/ai-chatassist/frontend/dist/ /var/www/aichatassist-dashboard/

sudo systemctl start aichatassist-backend
sudo nginx -t && sudo systemctl reload nginx
```

---

## Notes / gotchas

- Web Push requires HTTPS and a correct service worker (/sw.js).
- Multi-worker WebSockets require Redis (enabled via REDIS_URL).
- Widget domain lock is enforced: widget loader and sockets require correct origin/host matching the Website domain in the DB.
