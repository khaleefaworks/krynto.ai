# AI ChatAssist - Backend

FastAPI + PostgreSQL backend for real-time live chat with a human agent dashboard.

## Tech Stack

- **FastAPI** - Modern async web framework
- **PostgreSQL** - Production database
- **SQLAlchemy** - ORM
- **Alembic** - Database migrations
- **Uvicorn** - ASGI server
- **Redis** - Optional realtime Pub/Sub bridge + rate limiting
- **JWT** - Token-based authentication
- **bcrypt** - Password hashing

## Features

- ✅ REST API with JWT authentication
- ✅ WebSocket support for real-time chat
- ✅ Multi-website management
- ✅ Agent assignment and conversation workflow
- ✅ Visitor session management
- ✅ Widget configuration per website

## Prerequisites

- Python 3.12+
- PostgreSQL 16+ (installed natively)
- Redis 7+ (optional, for caching)

## Setup

### 1. Install PostgreSQL

```bash
sudo apt install -y postgresql postgresql-contrib
```

### 2. Create Database and User

```bash
sudo -u postgres psql -c "CREATE USER chatassist WITH PASSWORD 'chatassist';"
sudo -u postgres psql -c "CREATE DATABASE chatassist OWNER chatassist;"
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE chatassist TO chatassist;"
```

### 3. Create Virtual Environment

```bash
cd backend
python -m venv ../.venv
source ../.venv/bin/activate
pip install -r requirements.txt
```

### 4. Configure Environment

Create `.env` file in `backend/` directory:

```env
# Database
DATABASE_URL=postgresql+psycopg2://chatassist:chatassist@localhost:5432/chatassist

# Security (generate with: openssl rand -hex 32)
SECRET_KEY=your-secret-key-here

# Environment
ENV=development

# Optional - Redis
REDIS_URL=redis://localhost:6379/0

# Optional - CORS
CORS_ORIGINS=http://localhost:5173,http://localhost:3000
```

### 5. Run Database Migrations

```bash
alembic upgrade head
```

### 6. Start Development Server

```bash
# Using start script
./start_server.sh

# Optional flags
# - Apply Alembic migrations before starting
RUN_MIGRATIONS=1 ./start_server.sh

# - Skip DB connectivity preflight (not recommended)
SKIP_DB_CHECK=1 ./start_server.sh

# Or manually
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Server will be available at `http://localhost:8000`

Notes:
- `start_server.sh` performs a DB connectivity preflight so "CORS"-looking failures caused by a dead database show up as a clear startup error.
- The Alembic migrations are expected to apply cleanly on a fresh database; several migrations include guards for optional tables/columns due to historical branch/merge evolution.

## Production Run (No Docker)

Minimal checklist:

1) Set environment variables (example):

```env
ENV=production
DATABASE_URL=postgresql+psycopg2://chatassist:chatassist@localhost:5432/chatassist
SECRET_KEY=... # required; generate with: openssl rand -hex 32
PUBLIC_BASE_URL=https://api.yourdomain.com

# Comma-separated
CORS_ALLOWED_ORIGINS=https://app.yourdomain.com
```

2) Apply migrations on deploy:

```bash
alembic upgrade head
```

3) Run the server (recommended):

```bash
gunicorn -k uvicorn.workers.UvicornWorker \
  -w 2 \
  -b 0.0.0.0:8000 \
  app.main:app
```

Notes:
- Put this behind a reverse proxy (nginx/caddy) for TLS.
- Increase `-w` based on CPU cores and workload.

## API Endpoints

### Authentication
- `POST /auth/login` - Agent login (returns JWT token)
- `POST /auth/register` - Register new agent
- `GET /auth/me` - Get current agent details

### Websites
- `GET /websites` - List all websites
- `POST /websites` - Create new website
- `GET /websites/{id}` - Get specific website
- `PUT /websites/{id}` - Update website
- `DELETE /websites/{id}` - Delete website
- `GET /websites/{id}/widget-config` - Get widget configuration
- `PUT /websites/{id}/widget-config` - Update widget configuration

### Chats
- `GET /chats` - List active chats
- `POST /chats/{id}/messages` - Send message to chat
- `GET /chats/{id}` - Get chat details

### WebSocket
- `/ws/chat/{website_id}/{session_id}` - Visitor chat WebSocket
- `/ws/agent/{website_id}` - Agent dashboard WebSocket (website_id=0 for global notifications)

### Health
- `GET /health` - Health check endpoint

## Database & Migrations

- Migrations live in `alembic/versions/` (apply with `alembic upgrade head`)
- SQLAlchemy models live in `app/models/`

## Alembic Commands

```bash
# Generate new migration
alembic revision --autogenerate -m "description"

# Apply migrations
alembic upgrade head

# Rollback one migration
alembic downgrade -1

# View migration history
alembic history
```
- Environment variables are loaded from `.env` file
- PostgreSQL runs natively (not containerized)
- JWT tokens expire after 24 hours
- Password hashing uses bcrypt (not passlib)
- WebSocket connections support reconnection with session persistence

## Testing

### Manual API Testing

```bash
# Login
curl -X POST http://localhost:8000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"agent@test.com","password":"password"}'

# List websites (with auth)
curl http://localhost:8000/websites \
  -H "Authorization: Bearer YOUR_TOKEN"

# Create website
curl -X POST http://localhost:8000/websites \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"My Site","domain":"example.com"}'
```

### WebSocket Testing

Use the widget demo page at `http://localhost:8000/widget/demo.html`

## Troubleshooting

### Database Connection Issues

```bash
# Check PostgreSQL status
sudo systemctl status postgresql

# Connect to database
psql -U chatassist -d chatassist

# Reset database (CAUTION: deletes all data)
sudo -u postgres psql -c "DROP DATABASE chatassist;"
sudo -u postgres psql -c "CREATE DATABASE chatassist OWNER chatassist;"
alembic upgrade head
```

### Migration Issues

```bash
# View current revision
alembic current

# Rollback all migrations
alembic downgrade base

# Reapply all migrations
alembic upgrade head
```


## Production Deployment

1. Set `ENV=production` in `.env`
2. Use strong `SECRET_KEY` (generate with `openssl rand -hex 32`)
3. Enable HTTPS
4. Configure firewall rules
5. Set up proper logging
6. Use systemd service for auto-restart
7. Configure Nginx as reverse proxy
8. Set up database backups

## Default Credentials

**Agent Login:**
- Email: `agent@test.com`
- Password: `password`

**Important:** Change this password in production!

```bash
# Update password via psql
psql -U chatassist -d chatassist
UPDATE agents SET password_hash = '<bcrypt_hash>' WHERE email = 'agent@test.com';
```

## Performance Tips

- Use Redis for caching frequently accessed data
- Index database columns used in WHERE clauses
- Limit WebSocket message payload sizes
- Use connection pooling for database
- Enable compression for API responses

## Security Best Practices

- Always use HTTPS in production
- Rotate JWT secret keys periodically
- Implement rate limiting on authentication endpoints
- Sanitize user inputs
- Keep dependencies updated
- Review and limit CORS origins
- Use environment variables for secrets
- Enable PostgreSQL SSL connections

---

**For detailed setup instructions, see the main [README.md](../README.md)**
```
backend/
├── alembic/              # Database migrations
│   ├── versions/         # Migration files
│   ├── env.py           # Alembic environment config
│   └── script.py.mako   # Migration template
├── app/
│   ├── api/             # API routes
│   │   └── health.py    # Health check endpoint
│   ├── core/            # Core functionality
│   │   ├── config.py    # Settings management
│   │   ├── database.py  # Database connection
│   │   └── logging.py   # Logging setup
│   ├── models/          # SQLAlchemy models
│   │   ├── agent.py
│   │   ├── conversation.py
│   │   ├── message.py
│   │   └── website.py
│   └── main.py          # FastAPI application
├── .env                 # Environment variables (create this)
├── alembic.ini          # Alembic configuration
└── requirements.txt     # Python dependencies
```

## Development Notes

- Database migrations are tracked with Alembic
- All models include `created_at` and `updated_at` timestamps
- Environment variables are loaded from `.env` file
- PostgreSQL runs natively (not containerized)
