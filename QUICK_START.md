# 🚀 Quick Start - Run All Services

## Run Backend
```bash
cd /home/frappe/Applications/ai-chatassist/backend
source ../.venv/bin/activate
# Ensure backend/.env exists (DATABASE_URL, VAPID keys, etc.)
# Development requires PostgreSQL.

# Option A (recommended): run migrations automatically on start
RUN_MIGRATIONS=1 ./start_server.sh

# Option B: run migrations manually, then start the server
# alembic upgrade head
# ./start_server.sh
```

**Open:** http://localhost:8000/docs

---

## Run Frontend
```bash
cd /home/frappe/Applications/ai-chatassist/frontend
npm run dev
```

**Open:** http://localhost:5173

**If you see module errors:** Hard refresh browser with `Ctrl + Shift + R`

---

## Run Widget Demo
```bash
cd /home/frappe/Applications/ai-chatassist/widget
python3 -m http.server 8080
```

**Open:** http://localhost:8080/demo.html

---

## First Time Setup (Onboarding)

When you visit http://localhost:5173 for the first time, you'll see an **onboarding screen** to set up your administrator account.

- **Username:** `Administrator` (automatically set - this is how you'll login)
- **Password:** Set your secure password (minimum 8 characters)

After completing setup, you'll be logged in automatically.

---

## Login (After Setup)

Use these credentials to login:

- **Username:** `Administrator`
- **Password:** (the password you set during onboarding)

**Note:** For the Administrator account, use `Administrator` as the username (not an email address).

---

## Reset Application (Development Only)

To reset the application to fresh state (deletes all data):

```bash
cd /home/frappe/Applications/ai-chatassist/backend
source .venv/bin/activate
python3 reset_application.py
```

Type `YES` to confirm. This will show the onboarding screen again.

---

## Login (After Setup)

Use these credentials to login:

- **Username:** `Administrator`
- **Password:** (the password you set during onboarding)

**Note:** For the Administrator account, use `Administrator` as the username (not an email address).

---

## Manual Login (After Setup)

If you need to login manually:

- **Email:** administrator@system.local
- **Password:** (the password you set during onboarding)

---

## Bootstrap Admin User (Legacy - Not Recommended)

For backward compatibility only:

```bash
curl -X POST http://localhost:8000/auth/bootstrap \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Administrator",
    "email": "admin@example.com",
    "password": "admin123"
  }'
```

**Note:** Use the onboarding UI instead for better UX.

---

## That's It! 🎉

- **Dashboard:** http://localhost:5173
- **API Docs:** http://localhost:8000/docs
- **Widget Demo:** http://localhost:8080/demo.html

---

## Push Notifications (Development)

Push requires:
- HTTPS *or* a secure context (localhost is OK)
- VAPID keys configured in backend/.env

Generate VAPID keys:

```bash
cd /home/frappe/Applications/ai-chatassist/frontend
npx --yes web-push generate-vapid-keys
```

Paste them into backend/.env as:
- VAPID_PUBLIC_KEY
- VAPID_PRIVATE_KEY
- VAPID_SUBJECT (e.g. mailto:dev@localhost)

Then restart backend + open the dashboard and enable notifications.
