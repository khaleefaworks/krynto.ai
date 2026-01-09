Perfect. Below is a **clean, complete, single-source-of-truth PRD** that you can **save directly as `docs/PRD.md`**.

This includes:

* Clear scope
* Locked tech stack
* Architecture summary
* **Phase-wise execution plan**
* Success criteria
* What NOT to build

This is written exactly how a **solo founder + AI dev** should work.

---

# 📘 Product Requirements Document (PRD)

## **AI ChatAssist**

---

## 1. PRODUCT OVERVIEW

### 1.1 Product Name

**AI ChatAssist**

### 1.2 Product Type

Self-hosted **AI + Human Agent Support System**
(Multi-website, single owner, internal-first)

---

## 2. PROBLEM STATEMENT

Website visitors expect:

* Instant responses
* Accurate answers
* Human help when needed

AI can handle most queries, but:

* AI fails in edge cases
* Users want human reassurance
* Existing tools are expensive SaaS or overcomplicated

---

## 3. SOLUTION OVERVIEW

AI ChatAssist is a **hybrid support system**:

1. Visitor chats with **AI Bot**
2. AI answers using website-specific knowledge
3. If AI confidence is low or user requests help → **handoff to live agent**
4. Same conversation continues seamlessly

---

## 4. GOALS & NON-GOALS

### 4.1 Goals (MVP)

✅ AI-first chat support
✅ Human agent fallback
✅ Multi-website support
✅ Self-hosted
✅ Fast, simple, reliable

### 4.2 Non-Goals (Explicitly Out of Scope)

❌ Payments / subscriptions
❌ SaaS onboarding
❌ Multi-tenant accounts
❌ CRM integrations
❌ Native mobile apps (iOS/Android) for MVP

Note: PWA support for the Agent Dashboard is planned for production readiness to improve agent availability on mobile/desktop. See `docs/PWA_PLAN_OF_ACTION.md`.

---

## 5. USERS & ROLES

### 5.1 Website Visitor

* Anonymous
* Chats with AI
* May be transferred to agent

### 5.2 Agent (Internal)

* Handles escalated chats
* Uses Agent Dashboard (React)

### 5.3 Admin (You)

* Manages websites
* Uploads knowledge
* Configures AI behavior

---

## 6. DOMAIN MODEL (CORE CONCEPT)

```
System
 ├── Website (multiple)
 │    ├── Knowledge Base
 │    ├── AI Instructions
 │    ├── Chat Widget Config
 │    ├── Conversations
 │    └── Assigned Agents
 └── Agents
```

Each website is **fully isolated**:

* Separate knowledge base
* Separate instructions
* Separate conversations

---

## 7. TECH STACK (LOCKED)

### 7.1 Backend

| Area      | Tech             |
| --------- | ---------------- |
| Language  | Python 3.11      |
| Framework | FastAPI          |
| API       | REST + WebSocket |
| ORM       | SQLAlchemy       |
| DB        | PostgreSQL       |
| Cache     | Redis            |
| Queue     | RQ               |
| Logging   | structlog        |
| Auth      | JWT              |

---

### 7.2 AI Stack

| Purpose    | Tech                   |
| ---------- | ---------------------- |
| LLM        | OpenAI GPT-4o mini     |
| Fallback   | GPT-3.5                |
| Embeddings | text-embedding-3-small |
| Vector DB  | Chroma                 |

---

### 7.3 Frontend

#### Chat Widget (Visitor)

| Item      | Tech       |
| --------- | ---------- |
| Language  | Vanilla JS |
| Styling   | CSS        |
| Transport | WebSocket  |
| Embed     | Script tag |

#### Agent Dashboard

| Item       | Tech            |
| ---------- | --------------- |
| Framework  | React 18        |
| UI         | shadcn/ui       |
| Styling    | Tailwind CSS    |
| State      | Zustand         |
| Forms      | React Hook Form |
| Validation | Zod             |
| Routing    | React Router    |
| Charts     | Recharts        |

---

### 7.4 Infrastructure

| Area          | Tech |
| ------------- | ---- |
| Containers    | Docker (optional) / No-Docker (optional) — deployment decision pending |
| Process Mgmt  | If no Docker: systemd / supervisor (pick one) |
| Proxy         | Nginx (recommended) |

---

## 8. HIGH-LEVEL ARCHITECTURE

```
Visitor
  ↓
Chat Widget (JS)
  ↓ WebSocket
FastAPI Backend
  ├── Chat Orchestrator
  ├── AI Router → OpenAI
  ├── Agent Router → React Dashboard
  ├── Knowledge Retriever → Chroma
  └── Storage → Postgres
```

---

## 9. FUNCTIONAL REQUIREMENTS

### 9.1 Website Management

* Admin can add multiple websites
* Each website has:

  * Domain
  * AI instructions
  * Widget configuration

---

### 9.2 Knowledge Base

* Upload PDFs / text files
* Crawl website URLs
* Chunk and embed content
* Store per website

---

### 9.3 Chat Widget (Visitor)

* Load via script tag
* Start new session
* Send messages via WebSocket
* Display AI responses
* Detect agent handoff
* Show agent join indicator

---

### 9.4 AI Chat Flow

1. Receive visitor message
2. Load website instructions
3. Retrieve context from vector DB
4. Build prompt
5. Call LLM
6. Return response + confidence score

---

### 9.5 AI → Agent Handoff

**Triggers**

* Confidence < threshold
* User requests human
* AI fallback detected
* Manual admin trigger

**Behavior**

* AI pauses immediately
* Agent notified
* Conversation state preserved

---

### 9.6 Agent Dashboard (React)

#### Core Screens

1. Login
2. Website Selector
3. Active Chats
4. Chat View
5. Conversation History

#### Capabilities

* Join live chat
* View AI messages
* Reply in real time
* Close chat

---

## 10. NON-FUNCTIONAL REQUIREMENTS

### Performance

* WebSocket latency < 200ms
* AI response < 3s average

### Reliability

* Graceful AI failure handling
* Retry on API errors

### Security

* HTTPS
* JWT authentication
* Rate limiting

### Maintainability

* Modular backend
* Clear separation of concerns

---

## 11. API REQUIREMENTS (SUMMARY)

### REST

```
POST   /auth/login
GET    /websites
POST   /websites
GET    /chats/active
POST   /chats/{id}/join
POST   /chats/{id}/message
```

### WebSocket

```
/ws/chat/{website_id}/{session_id}
/ws/agent/{website_id}?token=<JWT>
# (Optional) global notifications use website_id = 0:
/ws/agent/0?token=<JWT>
```

---

## 12. DATA MODEL (HIGH LEVEL)

```
websites
knowledge_sources
documents
vectors (chroma metadata)
conversations
messages
agents
agent_sessions
```

---

## 13. PHASE-WISE EXECUTION PLAN (CRITICAL)

### 🔹 Phase 1 — Backend Foundation

* FastAPI project bootstrap
* Database connection
* Website model
* Agent model
* Conversation & message models

---

### 🔹 Phase 2 — Chat Core (Visitor)

* WebSocket chat endpoint
* Session management
* Message persistence
* Basic AI responses

---

### 🔹 Phase 3 — Agent Handoff

* Agent WebSocket
* Chat routing logic
* Pause AI on agent join
* Active chat queue

---

### 🔹 Phase 4 — Agent Dashboard (React)

* App layout
* Login
* Active chats list
* Chat UI
* Message streaming

---

### 🔹 Phase 5 — Knowledge System

* Document upload
* Website crawler
* Embedding generation
* Context retrieval

---

### 🔹 Phase 6 — Production Readiness

#### 6.1 Widget Configuration System
* Dynamic widget theming (colors, position)
* Per-website customization
* Backend API for widget config
* Widget fetches config on load

#### 6.2 Authentication & Authorization
* JWT-based authentication
* Password hashing with bcrypt
* Protected API endpoints
* Token persistence and refresh

#### 6.3 Website Management UI
* CRUD interface for websites
* Domain management
* AI instructions editor
* Website-specific settings

#### 6.4 Agent Assignment System
* Assign agents to specific websites
* Multi-agent support per website
* Agent availability management

#### 6.5 Knowledge Management UI
* Document upload interface
* Website crawler management
* Knowledge source listing
* Reindexing capabilities

#### 6.6 Operational Excellence
* Structured logging system
* Request rate limiting
* Error tracking
* Performance monitoring

#### 6.7 Deployment
* Deployment decision pending:
  * Option A (Docker): Dockerize backend + agent UI, use Nginx reverse proxy, compose for local-prod parity
  * Option B (No Docker): systemd/supervisor for backend + static hosting for frontend build, Nginx reverse proxy

#### 6.8 Agent Availability (PWA / Mobile)
Goal: improve agent “online” reliability and responsiveness across desktop + mobile.

Planned deliverables (implementation details tracked in `docs/PWA_PLAN_OF_ACTION.md`):
* Make the Agent Dashboard installable as a PWA (manifest + service worker).
* Presence should be heartbeat-based with a TTL/grace window (supports brief disconnects and multi-device).
* Add Web Push notifications for new visitor messages when the dashboard is backgrounded.
* Ensure the dashboard is usable on mobile (responsive layout + deep links to conversations).

---

## 14. MVP SUCCESS CRITERIA

✅ AI answers ≥ 70% queries
✅ Agent handoff works reliably
✅ Supports ≥ 3 websites
✅ Stable WebSocket sessions
✅ Daily usable system

---

## 15. FUTURE (NOT MVP)

* Analytics dashboard
* Multi-agent load balancing
* WhatsApp integration
* SaaS conversion
* Optional Frappe admin layer

---

## 16. FINAL NOTES

* **Do not redesign mid-build**
* **Finish Phase 1 → Phase 2 → …**
* **Docs are source of truth**
* **Chats are execution tools**

---

## 🚀 NEXT ACTION (DO THIS)

1️⃣ Save this as `docs/PRD.md`
2️⃣ Open a **new chat**
3️⃣ Say:

> **“Phase 1 – Backend bootstrap. Follow AI ChatAssist PRD.”**

From there, we execute step-by-step until it’s running.
You now have a **real, buildable product plan** 👏