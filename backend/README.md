# AI ChatAssist - Backend

FastAPI + PostgreSQL backend for AI-powered chat support system with human agent fallback.

## Tech Stack

- **FastAPI** - Modern async web framework
- **PostgreSQL** - Production database
- **SQLAlchemy** - ORM
- **Alembic** - Database migrations
- **Uvicorn** - ASGI server
- **OpenAI GPT-4o mini** - AI language model
- **Chroma** - Vector database for embeddings
- **Redis** - Caching and session management
- **JWT** - Token-based authentication
- **bcrypt** - Password hashing

## Features

- ✅ REST API with JWT authentication
- ✅ WebSocket support for real-time chat
- ✅ Multi-website management
- ✅ AI-powered responses with confidence scoring
- ✅ Agent handoff system
- ✅ Knowledge base with RAG (Retrieval-Augmented Generation)
- ✅ Document processing and embedding generation
- ✅ Visitor session management
- ✅ Widget configuration per website

## Prerequisites

- Python 3.12+
- PostgreSQL 16+ (installed natively)
- Redis 7+ (optional, for caching)
- OpenAI API key

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

# OpenAI
OPENAI_API_KEY=your-openai-api-key-here

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

# Or manually
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Server will be available at `http://localhost:8000`

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

### Knowledge Base
- `POST /knowledge/upload` - Upload document
- `GET /knowledge/sources` - List knowledge sources
- `DELETE /knowledge/sources/{id}` - Delete knowledge source
- `POST /knowledge/reindex` - Reindex knowledge base

### WebSocket
- `/ws/chat/{website_id}` - Visitor chat WebSocket
- `/ws/agent/{agent_id}` - Agent dashboard WebSocket

### Health
- `GET /health` - Health check endpoint

## Database Schema
│   ├── eeb28dc4e63a_initial_schema.py
│   │   ├── 65f8a6004dce_phase3_agent_handoff.py
│   │   ├── 7b896e76a93d_phase5_knowledge_system_schema.py
│   │   ├── 6168d0a84d56_add_widget_config_to_websites.py
│   │   └── e06f52023418_add_password_hash_to_agents.py
│   ├── env.py           # Alembic environment config
│   └── script.py.mako   # Migration template
├── app/
│   ├── api/             # API routes
│   │   ├── auth.py      # Authentication endpoints
│   │   ├── chats.py     # Chat management
│   │   ├── health.py    # Health check
│   │   ├── knowledge.py # Knowledge base management
│   │   ├── websites.py  # Website CRUD & config
│   │   ├── ws_chat.py   # Visitor WebSocket
│   │   └── ws_agent.py  # Agent WebSocket
│   ├── core/            # Core functionality
│   │   ├── config.py    # Settings management
│   │   ├── database.py  # Database connection
│   │   ├── logging.py   # Logging setup
│   │   └── security.py  # JWT & password hashing
│   ├── models/          # SQLAlchemy models
│   │   ├── agent.py
│   │   ├── agent_session.py
│   │   ├── conversation.py
│   │   ├── document.py
│   │   ├── knowledge_chunk.py
│   │   ├── knowledge_source.py
│   │   ├── message.py
│   │   └── website.py
│   ├── services/        # Business logic
│   │   ├── ai_service.py          # OpenAI integration
│   │   ├── agent_service.py       # Agent handoff logic
│   │   ├── chat_service.py        # Chat orchestration
│   │   ├── chunking_service.py    # Text chunking
│   │   ├── confidence.py          # Confidence scoring
│   │   ├── document_parser.py     # Document processing
│   │   ├── embedding_service.py   # Embedding generation
│   │   ├── knowledge_indexer.py   # Knowledge indexing
│   │   ├── prompt_builder.py      # Prompt engineering
│   │   ├── retrieval_service.py   # RAG retrieval
│   │   └── vector_store.py        # Chroma integration
│   └── main.py          # FastAPI application
├── .env                 # Environment variables (create this)
├── alembic.ini          # Alembic configuration
├── requirements.txt     # Python dependencies
├── start_server.sh      # Server startup script
└── README.md            # This file
- **documents** - Document metadata
  - `id`, `knowledge_source_id`, `title`, `content_hash`, `processed_at`

- **knowledge_chunks** - Text chunks for RAG
  - `id`, `document_id`, `chunk_index`, `content`, `embedding`, `metadata`

- **agent_sessions** - Agent handoff tracking
  - `id`, `conversation_id`, `agent_id`, `joined_at`, `left_at`

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
 via `TimestampMixin`
- Environment variables are loaded from `.env` file
- PostgreSQL runs natively (not containerized)
- JWT tokens expire after 24 hours
- Password hashing uses bcrypt (not passlib)
- WebSocket connections support reconnection with session persistence
- AI confidence threshold for agent handoff: 0.7
- OpenAI model: gpt-4o-mini (fallback: gpt-3.5-turbo)
- Embedding model: text-embedding-3-small
- Vector store: Chroma (persistent storage)

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
  -d '{"name":"My Site","domain":"example.com","ai_instructions":"Be helpful"}'
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

### OpenAI API Issues

- Verify API key is valid
- Check billing status at platform.openai.com
- Review rate limits
- Check backend logs for detailed error messages

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
- Monitor OpenAI API usage and costs

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
