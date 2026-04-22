# Quick Start

Get AI ChatAssist running locally in under 10 minutes.

## Prerequisites

- **Python 3.11+**
- **Node.js 20+** (use [nvm](https://github.com/nvm-sh/nvm))
- **PostgreSQL 14+**
- **Git**

```bash
sudo apt update
sudo apt install -y git python3 python3-venv python3-pip nodejs npm postgresql postgresql-contrib
```

## 1. Clone the repository

```bash
git clone <your-repo-url> ~/Applications/ai-chatassist
cd ~/Applications/ai-chatassist
```

## 2. Database setup

```bash
sudo -u postgres psql
```
```sql
CREATE DATABASE aichatassist;
CREATE USER aichatassist WITH PASSWORD 'yourpassword';
GRANT ALL PRIVILEGES ON DATABASE aichatassist TO aichatassist;
\q
```

## 3. Backend

```bash
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

Copy and edit the environment file:
```bash
cp .env.example .env
# Edit .env: set DATABASE_URL, SECRET_KEY, FRONTEND_URL, BACKEND_URL
```

Run migrations and seed:
```bash
alembic upgrade head
python reset_application.py --seed
```

Start the server:
```bash
./start_server.sh
# or: uvicorn app.main:app --reload --port 8000
```

Backend is now running at `http://localhost:8000`.

## 4. Frontend dashboard

```bash
cd ../frontend
npm install
```

Create `.env.local`:
```bash
VITE_API_BASE=http://localhost:8000
```

Start:
```bash
npm run dev
# Dashboard at http://localhost:5173
```

## 5. Widget demo

Open `widget/demo.html` in your browser (or serve it via a simple HTTP server):
```bash
cd ../widget
npx serve .
# Demo at http://localhost:3000/demo.html
```

## 6. Login

After seeding, the default owner credentials are printed to the console by `reset_application.py`. Use them to log into the dashboard at `http://localhost:5173`.

## Optional services

### Redis (required for multi-worker production)
```bash
sudo apt install -y redis-server
# Set REDIS_URL=redis://localhost:6379 in backend/.env
```

### Push notifications (VAPID)
```bash
pip install pywebpush
# Generate keys and add VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_CLAIMS_EMAIL to .env
```

### Email (Resend)
```bash
# Add RESEND_API_KEY and MAIL_FROM to backend/.env
```

## Health check

```
GET http://localhost:8000/health
```

Should return `{"status": "ok"}`.

## Running tests

```bash
cd backend
source venv/bin/activate
pytest tests/ -v
```
