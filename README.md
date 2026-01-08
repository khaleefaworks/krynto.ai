# AI ChatAssist

Self-hosted AI + Human Agent Support System for multi-website customer support.

## 🎯 Overview

AI ChatAssist is a hybrid support system that combines AI-powered chatbots with seamless human agent fallback. Deploy once, manage multiple websites with separate knowledge bases and dedicated support teams.

### Key Features

- 🤖 **AI-First Response** - GPT-4o mini handles initial customer queries
- 👥 **Smart Agent Handoff** - Automatic escalation based on confidence or user request
- 🌐 **Multi-Website Support** - Manage multiple sites from single dashboard
- 📚 **Knowledge Base** - Website-specific AI training with document uploads
- 💬 **Real-Time Chat** - WebSocket-based instant messaging
- 🎨 **Customizable Widget** - Theme colors, position, welcome messages per site
- 🔐 **Secure by Default** - JWT authentication, bcrypt password hashing

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    AI ChatAssist System                      │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌──────────────┐      ┌──────────────┐      ┌───────────┐ │
│  │   Visitor    │      │    Agent     │      │   Admin   │ │
│  │   Widget     │◄────►│  Dashboard   │◄────►│  Portal   │ │
│  │ (Vanilla JS) │      │   (React)    │      │  (React)  │ │
│  └──────┬───────┘      └──────┬───────┘      └─────┬─────┘ │
│         │ WebSocket            │ WebSocket          │ HTTP  │
│         └──────────────────────┼────────────────────┘       │
│                                ▼                             │
│                    ┌────────────────────┐                    │
│                    │   FastAPI Backend  │                    │
│                    │   ┌────────────┐   │                    │
│                    │   │   Chat     │   │                    │
│                    │   │Orchestrator│   │                    │
│                    │   └─────┬──────┘   │                    │
│                    │         │          │                    │
│         ┌──────────┼─────────┼──────────┼──────────┐        │
│         ▼          ▼         ▼          ▼          ▼        │
│    ┌────────┐ ┌────────┐ ┌────────┐ ┌──────┐ ┌────────┐   │
│    │OpenAI  │ │ Chroma │ │Postgres│ │Redis │ │  RQ    │   │
│    │GPT-4o  │ │Vector  │ │  DB    │ │Cache │ │ Queue  │   │
│    └────────┘ └────────┘ └────────┘ └──────┘ └────────┘   │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

## 🛠️ Tech Stack

### Backend
- **FastAPI** - Modern async Python web framework
- **PostgreSQL** - Primary database
- **SQLAlchemy** - ORM with Alembic migrations
- **Redis** - Caching layer
- **OpenAI GPT-4o mini** - AI language model
- **Chroma** - Vector database for embeddings
- **JWT** - Authentication tokens
- **WebSocket** - Real-time bidirectional communication

### Frontend (Agent Dashboard)
- **React 18** with TypeScript
- **Vite** - Fast build tooling
- **Tailwind CSS** - Utility-first styling
- **shadcn/ui** - High-quality component library
- **Zustand** - Lightweight state management
- **React Router** - Client-side routing
- **React Hook Form + Zod** - Form handling and validation

### Chat Widget (Visitor)
- **Vanilla JavaScript** - No framework dependencies
- **Plain CSS** - Minimal, performant styling
- **WebSocket** - Direct connection to backend

## 📦 Project Structure

```
ai-chatassist/
├── backend/           # FastAPI application
│   ├── alembic/      # Database migrations
│   ├── app/
│   │   ├── api/      # REST & WebSocket endpoints
│   │   ├── core/     # Config, DB, security
│   │   ├── models/   # SQLAlchemy models
│   │   └── services/ # Business logic
│   ├── requirements.txt
│   └── README.md
├── frontend/          # React agent dashboard
│   ├── src/
│   │   ├── components/
│   │   ├── pages/
│   │   ├── services/
│   │   └── store/
│   ├── package.json
│   └── README.md
├── widget/            # Embeddable chat widget
│   ├── chat-widget.js
│   ├── chat-widget.css
│   ├── demo.html
│   └── README.md
└── docs/
    └── PRD.md        # Product Requirements Document
```

## 🚀 Quick Start

### Prerequisites

- Python 3.12+
- Node.js 18+
- PostgreSQL 16+
- Redis 7+
- OpenAI API key

### 1. Backend Setup

```bash
# Install PostgreSQL
sudo apt install -y postgresql postgresql-contrib

# Create database
sudo -u postgres psql -c "CREATE USER chatassist WITH PASSWORD 'chatassist';"
sudo -u postgres psql -c "CREATE DATABASE chatassist OWNER chatassist;"

# Setup backend
cd backend
python -m venv ../.venv
source ../.venv/bin/activate
pip install -r requirements.txt

# Configure environment
cat > .env << EOF
DATABASE_URL=postgresql+psycopg2://chatassist:chatassist@localhost:5432/chatassist
OPENAI_API_KEY=your-openai-api-key
SECRET_KEY=$(openssl rand -hex 32)
ENV=development
EOF

# Run migrations
alembic upgrade head

# Start server
./start_server.sh
```

Backend runs at `http://localhost:8000`

### 2. Frontend Setup

```bash
cd frontend
npm install
npm run dev
```

Agent dashboard runs at `http://localhost:5173`

### 3. Widget Setup

Add to your website (recommended):

```html
<!-- AI ChatAssist Live Chat script -->
<script type="text/javascript">
  var _aichatassist = _aichatassist || {};
  _aichatassist.key = "YOUR_WIDGET_KEY";
  window.aichatassist||(function(d) {
    var s,c,o=aichatassist=function(){ o._.push(arguments)}; o._=[];
    s=d.getElementsByTagName('script')[0];c=d.createElement('script');
    c.type='text/javascript';c.charset='utf-8';c.async=true;
    c.src='http://localhost:8000/widget/loader.js?key=' + _aichatassist.key;
    s.parentNode.insertBefore(c,s);
  })(document);
</script>
```

## 📖 Usage

### Default Login Credentials

- **Email:** `agent@test.com`
- **Password:** `password`

### Managing Websites

1. Log in to agent dashboard
2. Navigate to "Websites" tab
3. Click "Add Website"
4. Enter domain and AI instructions
5. Configure widget appearance

### Uploading Knowledge

1. Select website
2. Go to Knowledge section
3. Upload PDFs, text files, or add URLs
4. System automatically processes and indexes content

### Handling Chats

1. Active chats appear in "Active Chats" tab
2. Click conversation to view full history
3. Type and send replies in real-time
4. AI automatically pauses when agent joins

## 🔧 Configuration

### Environment Variables (Backend)

| Variable | Description | Required |
|----------|-------------|----------|
| `DATABASE_URL` | PostgreSQL connection string | Yes |
| `OPENAI_API_KEY` | OpenAI API key | Yes |
| `SECRET_KEY` | JWT signing key (generate with `openssl rand -hex 32`) | Yes |
| `ENV` | Environment (`development` or `production`) | Yes |
| `REDIS_URL` | Redis connection string | No |
| `CORS_ORIGINS` | Allowed CORS origins (comma-separated) | No |

### Widget Configuration

Per-website configuration via dashboard:

- **Theme:** `light` or `dark`
- **Position:** `bottom-right`, `bottom-left`, `top-right`, `top-left`
- **Primary Color:** Hex color code
- **Welcome Message:** Initial greeting text

## 🔐 Security

- **Authentication:** JWT tokens with 24-hour expiration
- **Password Hashing:** bcrypt with automatic salt generation
- **HTTPS:** Recommended for production deployments
- **Rate Limiting:** Built-in request throttling
- **Input Validation:** Pydantic models on all endpoints

## 📊 Database Migrations

```bash
# Create new migration
cd backend
alembic revision --autogenerate -m "description"

# Apply migrations
alembic upgrade head

# Rollback one version
alembic downgrade -1
```

## 🧪 Testing

### Backend Tests

```bash
cd backend
pytest
```

### Frontend Tests

```bash
cd frontend
npm test
```

## 📈 Monitoring

### Logs

```bash
# Backend logs
tail -f backend/logs/app.log

# Frontend dev server logs
npm run dev
```

### Metrics

- WebSocket connection status
- Active conversations count
- AI confidence scores
- Agent response times

## 🐳 Docker Deployment

```bash
# Build and start all services
docker-compose up -d

# View logs
docker-compose logs -f

# Stop services
docker-compose down
```

Services available at:
- Backend: `http://localhost:8000`
- Frontend: `http://localhost:3000`
- Widget: `http://localhost:8000/widget/`

## 🤝 Contributing

This is a self-hosted project for personal/internal use. Fork and customize as needed.

## 📄 License

MIT License - See LICENSE file for details

## 🔗 Resources

- [Product Requirements Document](docs/PRD.md)
- [Backend Documentation](backend/README.md)
- [Frontend Documentation](frontend/README.md)
- [Widget Documentation](widget/README.md)

## 🆘 Troubleshooting

### WebSocket Connection Failed

- Check backend is running on port 8000
- Verify CORS origins include your frontend URL
- Ensure Redis is running for session management

### AI Not Responding

- Verify `OPENAI_API_KEY` is set correctly
- Check OpenAI API quota and billing
- Review backend logs for API errors

### Widget Not Loading

- Verify script tag has correct `data-website-id`
- Check browser console for CORS errors
- Ensure backend serves static files at `/widget/`

### Database Connection Error

- Verify PostgreSQL is running: `sudo systemctl status postgresql`
- Check credentials in `DATABASE_URL`
- Ensure database exists: `psql -U chatassist -d chatassist`

## 📞 Support

For issues and questions:
1. Check documentation in `docs/`
2. Review backend logs
3. Inspect browser console for frontend errors

---

**Built with ❤️ for seamless customer support**
