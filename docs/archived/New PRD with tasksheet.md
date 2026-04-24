# 📘 NEW PRD

This PRD **replaces all previous versions** and is the **single source of truth**.

---

## **Product Name**

**AI ChatAssist**

(AI remains the destination, live chat is the foundation)

---

## 1. PRODUCT VISION (FINAL)

> **AI ChatAssist is a self-hosted, multi-website customer support platform where AI is the primary assistant and human agents seamlessly take over when needed.**

However:

> **The Live Agent system must be complete, reliable, and production-ready before AI is enabled for any website.**

---

## 2. DEVELOPMENT STRATEGY (LOCKED)

### Phase Order (Non-Negotiable)

1. **Live Agent Chat (Foundation)**
2. **Agent Dashboard & UX**
3. **Reliability, Presence, Offline Handling**
4. **AI Integration (Website-Level Enablement)**
5. **AI Becomes Primary**

This is about **build order**, not product importance.

---

## 3. CORE PRINCIPLES

1. **Live chat must work perfectly without AI**
2. **AI is layered, not intertwined**
3. **AI enablement is website-specific**
4. **One conversation, one continuity**
5. **Clear online/offline behavior**
6. **Multi-website from day one**
7. **Self-hosted, internal-first**

---

## 4. WHAT THIS PRODUCT IS

> A **hybrid AI + Live Agent chat system** for websites, similar to Intercom / Crisp — but self-hosted and controllable.

---

## 5. USER ROLES

### 5.1 Administrator (Full Access)

* First user created on fresh setup
* Manages:

  * Websites
  * Agents
  * Settings
  * AI configuration (per website)
* Can also act as an agent

### 5.2 Agent (Limited Access)

* Handles conversations
* Can toggle availability
* Access only:

  * Chats
  * Personal settings

### 5.3 Visitor

* Anonymous
* Chats via widget
* Interacts with AI **only if enabled for that website**

---

## 6. SYSTEM STRUCTURE

```
System
 ├── Websites (multiple)
 │    ├── Chat Widget
 │    ├── Conversations
 │    ├── Assigned Agents
 │    ├── AI Enabled (true / false)
 │    └── Knowledge Base
 └── Users (Admins + Agents)
```

Each website is **fully isolated**, including AI behavior.

---

## 7. LIVE AGENT CHAT (FOUNDATION FEATURE)

### 7.1 Core Capabilities

* Real-time WebSocket chat
* WhatsApp-like experience
* One agent owns a conversation
* Unread message indicators
* Multi-website inbox
* Agent availability control

### 7.2 Agent Availability

Each agent has:

* **Connection status** (online/offline)
* **Availability toggle** (available/busy)

Only agents who are:

* Assigned to the website
* Online
* Available
  receive new chats.

---

## 8. ONLINE / OFFLINE BEHAVIOR (WITHOUT AI)

### Online

* At least one available agent
* Widget shows: **“We’re online”**
* Messages routed instantly

### Offline

* No available agents
* Widget shows: **“We’re offline”**
* Visitor can leave a message
* Message stored for later follow-up

> This behavior **must work even if AI does not exist**.

---

## 9. DASHBOARD (ADMIN + AGENT)

### 9.1 Layout (LOCKED)

#### Left Sidebar (Collapsed)

* Icons only
* Order:

  1. Chats (default)
  2. Settings
  3. Analytics (Coming Soon)

Bottom:

* Profile icon

  * Availability toggle
  * Logout

No dashboard home page.

---

## 10. CHAT PAGE (MOST IMPORTANT UI)

### 3-Column Layout

```
| Conversations | Chat | Details |
```

#### Conversations

* Filtered by website
* Unread badges
* Real-time updates

#### Chat

* Clean message bubbles
* Agent join indicator
* Smooth scrolling

#### Details

* Visitor info
* Notes
* Tags
* Future CRM data

---

## 11. SETTINGS STRUCTURE

```
Settings
├── Websites
│   ├── Account Settings
│   ├── Agents
│   ├── Chat Widget
│   ├── AI Settings (PER WEBSITE)
│   │   ├── Enable / Disable AI
│   │   ├── Confidence Threshold
│   │   └── Fallback Rules
│   ├── Tags
│   └── Shortcuts
│
├── Personal
│   ├── Profile
│   └── Notifications
```

---

## 12. AI FEATURE (PRIMARY, WEBSITE-SCOPED)

### 12.1 AI Enablement Rules

* AI is **disabled by default**
* AI is enabled **per website**
* Optional (later): global master kill switch

**Effective AI state:**

```
AI_ACTIVE = Global_AI_Enabled (optional)
            AND Website_AI_Enabled
```

---

### 12.2 AI Behavior (When Enabled for a Website)

* AI responds first
* Uses **that website’s** knowledge base
* Confidence scoring applied
* Hands off to agent when:

  * Confidence is low
  * User requests human
  * Agent manually joins

---

### 12.3 Critical Rule

> **AI must pause immediately when a human agent joins the conversation.**

No mixed responses.

---

## 13. CHAT WIDGET

* Embedded via script tag
* Behavior depends on **website configuration**
* Shows:

  * Online / Offline
  * AI / Human seamlessly
* Same UI regardless of responder

---

## 14. TECH STACK (UNCHANGED)

* Backend: FastAPI, PostgreSQL, WebSockets
* Frontend: React, Tailwind, Zustand
* Widget: Vanilla JS
* AI: OpenAI (later phase)

---

## 15. MVP SUCCESS CRITERIA

### Phase 1 (Before AI)

✅ Live chat stable
✅ Multi-website agent handling
✅ Offline messages work
✅ Real-time unread updates
✅ Agent availability respected

### Phase 2 (With AI)

✅ AI enabled per website
✅ AI disabled websites behave as pure live chat
✅ Seamless AI → agent handoff
✅ No AI cost for disabled websites

---

## 16. FINAL RULE (NON-NEGOTIABLE)

> **AI is a website-level feature, not a system assumption.**

Live chat must feel **boringly reliable** before AI is turned on.

---

==================================================================================================

Below is a **DETAILED, IMPLEMENTATION-READY TASK SHEET**, derived **directly and only** from the **combined gap summary** and the **locked PRD**.

This is **not a vague roadmap**.
This is a **developer task sheet** you can put into Notion / Linear / GitHub Projects.

---

# 🧾 AI ChatAssist – DETAILED TASK SHEET

*(Derived from Final PRD & Gap Analysis)*

Legend:

* 🧱 Backend
* 🧩 Widget
* 🖥️ Dashboard (React)
* 🔐 Auth / Roles
* 🔀 WebSocket

Priority levels:

* **P0** = Blocking / Must do first
* **P1** = Core functionality
* **P2** = UX / Polish / Non-blocking

---

## 🟢 MILESTONE 1 — LIVE AGENT SYSTEM HARDENING (NO AI)

> Goal: Live chat must be *boringly reliable* without AI.

---

### 🧱 BACKEND — CORE LOGIC (P0)

#### 1. Introduce Unified User Model

* [ ] Replace `Agent`-only mindset with **User**
* [ ] Add role field:

  * `FULL_ACCESS`
  * `LIMITED_ACCESS`
* [ ] Keep agent capabilities under User
* [ ] Update auth dependencies to use User

---

#### 2. First-Time Setup Flow

* [ ] Detect fresh installation (no users exist)
* [ ] Block all access until Admin created
* [ ] API to create first Admin user
* [ ] Mark Admin as FULL_ACCESS

---

#### 3. Agent Availability Enforcement

* [ ] Add `is_available` field to User
* [ ] Default: `true`
* [ ] API to toggle availability
* [ ] Enforce availability in chat routing

---

#### 4. Website Online/Offline Resolver

* [ ] Create service:

  * `is_website_online(website_id)`
* [ ] Logic:

  * Assigned agents
  * WebSocket connected
  * is_available = true
* [ ] Reusable across widget + dashboard

---

#### 5. Conversation State Expansion

* [ ] Add `offline` state to Conversation
* [ ] Formalize lifecycle:

  * active
  * offline
  * closed
* [ ] Persist unread state explicitly

---

#### 6. System Message Support

* [ ] Add `system` sender type
* [ ] Standardize system messages:

  * Offline notice
  * Agent joined
  * Conversation assigned

---

### 🔀 BACKEND — CHAT ROUTING (P0)

#### 7. Invert Chat Routing Logic (Live Agent First)

* [ ] Refactor ChatService entry point
* [ ] New routing order:

  1. Resolve website
  2. Check agent availability
  3. Route to live agent OR offline
* [ ] Remove AI-first assumptions

---

#### 8. Offline Message Flow

* [ ] Accept messages when no agents online
* [ ] Mark conversation as offline
* [ ] Emit system message
* [ ] Persist for later follow-up

---

## 🧩 WIDGET — ONLINE/OFFLINE BEHAVIOR (P0)

#### 9. Widget Status API

* [ ] Create endpoint:

  * `/widget/status?website_id=`
* [ ] Response:

  * online: boolean
  * ai_enabled: boolean (future-proof)

---

#### 10. Widget Online/Offline UI States

* [ ] Show “We’re online” when true
* [ ] Show “We’re offline” when false
* [ ] Disable chat input in offline mode
* [ ] Show offline message form

---

#### 11. Offline Message Submission

* [ ] Submit offline messages to backend
* [ ] Show confirmation to visitor
* [ ] Do not open chat thread

---

#### 12. System Message Rendering

* [ ] Render system messages distinctly
* [ ] Handle:

  * Offline notice
  * Agent joined
  * Waiting for agent

---

## 🖥️ DASHBOARD — CHAT FOUNDATION (P0)

#### 13. Remove Dashboard Home Page

* [ ] Make `/chats` default route
* [ ] Redirect post-login to Chats
* [ ] Remove dashboard widgets

---

#### 14. Sidebar Refactor (Collapsed)

* [ ] Icons-only sidebar
* [ ] Order:

  1. Chats
  2. Settings
  3. Analytics (Coming Soon)
* [ ] Profile icon at bottom

---

#### 15. Availability Toggle (UI)

* [ ] Add toggle in profile dropdown
* [ ] Call availability API
* [ ] Reflect real-time state

---

#### 16. Website-Scoped Chat Inbox

* [ ] Enforce website filtering
* [ ] Show only assigned websites
* [ ] Add website selector to chat page

---

## 🟡 MILESTONE 2 — CHAT UX & REAL-TIME POLISH

> Goal: WhatsApp-like clarity and responsiveness.

---

### 🔀 WEBSOCKETS (P1)

#### 17. Explicit WebSocket Event Types

* [ ] Define events:

  * `conversation_unread`
  * `conversation_assigned`
  * `agent_joined`
  * `conversation_closed`
* [ ] Update backend emitters
* [ ] Update frontend listeners

---

#### 18. Unread Message Logic

* [ ] Mark unread on visitor message
* [ ] Clear unread on agent open
* [ ] Broadcast unread count updates

---

### 🖥️ DASHBOARD — CHAT UX (P1)

#### 19. 3-Column Chat Layout

* [ ] Conversations list (left)
* [ ] Chat view (center)
* [ ] Metadata panel (right)

---

#### 20. Assignment Indicators

* [ ] Show:

  * Unassigned
  * Assigned to you
  * Assigned to another agent

---

#### 21. Metadata Panel (Read-only)

* [ ] Visitor info
* [ ] Conversation status
* [ ] Notes placeholder
* [ ] Tags placeholder

---

## 🟡 MILESTONE 3 — SETTINGS & STRUCTURE

> Goal: Clean admin control before AI enters.

---

### 🔐 AUTH & ROLES (P1)

#### 22. Role-Based UI Guarding

* [ ] Hide admin menus for agents
* [ ] Restrict settings routes
* [ ] Backend permission checks

---

### 🖥️ DASHBOARD — SETTINGS (P1)

#### 23. Settings Information Architecture

* [ ] Split:

  * Websites
  * Personal
* [ ] Enforce role visibility

---

#### 24. Analytics Placeholder

* [ ] Add Analytics page
* [ ] Show “Coming Soon”

---

## 🔵 MILESTONE 4 — AI PREPARATION (NOT IMPLEMENTATION)

> Goal: Make AI pluggable, not active.

---

### 🧱 BACKEND (P2)

#### 25. Website-Level AI Flag

* [ ] Add `ai_enabled` to Website
* [ ] Default: false
* [ ] Do NOT use yet

---

#### 26. AI Guard Rails

* [ ] Ensure AI pipeline can be bypassed fully
* [ ] No AI calls when disabled

---

### 🖥️ DASHBOARD (P2)

#### 27. AI Settings UI (Hidden / Disabled)

* [ ] Per-website toggle
* [ ] Disabled by default
* [ ] No behavior change yet

---

# ✅ TASK SHEET STATUS

* ✅ Derived strictly from PRD
* ✅ No premature AI work
* ✅ Correct execution order
* ✅ Backend → Widget → Dashboard
* ✅ Zero scope creep

---