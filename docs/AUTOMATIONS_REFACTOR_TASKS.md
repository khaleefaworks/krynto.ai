# Automations & Message Taxonomy Refactor

This document is both:
1) a rationale ("why are we changing this") and
2) a task tracker ("what exactly do we change, in what order").

It is intentionally written so a new contributor can understand the problem space without reading chat logs.

---

## Executive Summary

We want a solid chat system that feels consistent like WhatsApp, and powerful/structured like Smartsupp.

Today the product already has:
- visitor ↔ agent chat
- system/bot-like informational messages (welcome, wait, offline prompts, resolve/close)
- real-time WebSocket delivery to widget and agent dashboard

But these "bot/system" messages are currently wired from multiple places, with inconsistent semantics and payloads.

This refactor introduces:
- a strict, future-proof message taxonomy (actor + kind)
- a per-website automation engine (triggers → conditions → actions)
- a Smartsupp-style UI to manage automations (Templates + Build from scratch)

---

## Why We’re Doing This (Rationale)

### 1) Correctness and consistency
Right now, the same real-world event can surface as different messages depending on transport:
- resolve is persisted as one text, while a different “closed” message is sent live over WS

That breaks expectations and makes debugging hard.

### 2) Control and configurability (per website)
Some automated messages are hardcoded (wait/offline), others are semi-configurable (welcome).
There is no single place to control automation behavior per website (timings, text, enable/disable, caps).

### 3) Preparing for AI without conflating it with Bot
We plan to add AI later. AI is not the same thing as “bot automation messages”.

If we don’t fix terminology now, adding AI will multiply confusion:
- transport `type: "ai"` is currently used for non-AI bot messages
- DB schema has no “bot” or “ai” sender type today

### 4) Product scalability
Smartsupp’s strength is repeatable playbooks (templates) and a builder that non-technical users can use.
To reach that, we need a deterministic automation layer with clear triggers, conditions, and actions.

---

## Conversation Summary (How We Got Here)

### Earlier milestones completed in this repo
- Clarified widget identity (widget key vs website id) and hardened production multi-worker requirements.
- Implemented real-time UX improvements (typing + presence reconnect) across backend, frontend, widget.
- Fixed agent UI resolved list selection and read-only behavior for resolved conversations.

### The key product direction
We decided to build Smartsupp-like structure:
- Templates page
- “Build from scratch” slide-over
- Separate editor areas: Design / Settings / Statistics

### The key technical discovery
Our “bot/system” messages are not centralized:
- welcome automation happens in the chat WS layer
- waiting/offline prompts happen in the conversation orchestrator
- resolve persists one message text, while WS sends a different one

This is the root reason a Smartsupp-like automation system can’t be layered cleanly without a refactor.

---

## Current Architecture (How It Works Today)

### Current persisted message types (DB)
In DB we only have `sender_type`:
- visitor
- agent
- system

There is no first-class `bot` or `ai` sender type today.

### How “bot” exists today (encoding)
Bot messages are stored as `sender_type=system` but marked by:
- `sender="bot"` and/or
- `event_type` like `automation_welcome` or `bot`

### Transport payload mismatch
The widget receives WS events where `type` might be:
- `ai` (used today for bot/automation messages)
- `agent`
- `agent_joined`
- `system`

This means transport naming is currently misleading (AI vs bot).

### Where messages are created today (single source of truth does not exist)

1) Welcome automation (semi-configurable)
- Location: backend/app/api/ws_chat.py
- Config: website.widget_config["automations"]
- Persisted as system message: event_type=automation_welcome, sender=bot
- Sent to widget as WS: type=ai

2) Waiting message after 60s if still unassigned (hardcoded)
- Location: backend/app/services/conversation_orchestrator.py
- Persisted as system message: event_type=bot, sender=bot
- Sent to widget as WS: type=ai

3) Offline prompt (hardcoded)
- Location: backend/app/services/conversation_orchestrator.py
- Persisted as system message: event_type=bot, sender=bot
- Sent to widget as WS: type=ai

4) Resolve/close
- Persisted resolve message text: backend/app/services/conversation_service.py
- WS “closed” message (different text) not persisted: backend/app/services/conversation_orchestrator.py

### Current UI interpretation (agent + widget)
Both agent UI and widget infer meaning using a mix of:
- sender_type
- sender
- event_type

This works, but it’s fragile and makes new features costly.

---

## Target Architecture (How It Should Work)

### Message Taxonomy (industry-style)

We standardize on two orthogonal fields:

**Actor (who is speaking):**
- visitor | agent | bot | ai | system

**Kind (what it is):**
- chat | event

Rules:
- visitor/agent/bot/ai ⇒ `kind=chat`
- system ⇒ `kind=event`
- Timestamp separators and unread dividers are UI-only (not stored messages)

Why this matches industry best practice:
- WhatsApp-like systems clearly separate conversational content from timeline/system events.
- Smartsupp-like automations become predictable because bot messages are explicitly bot messages.

### Resolve behavior (best option)
Best practice is:
- Always persist resolve as a **system event** (`actor=system, kind=event, event_type=conversation_resolved`).
- Optionally send a **configurable bot closing message** (`actor=bot, kind=chat`) per website.

This gives:
- consistent audit trail
- flexible UX per website/brand
- avoids mixing “system state change” with “persona message”

### Automations (Smartsupp-like) are first-class
Automations become per-website policies:

**Trigger → Conditions → Actions**

Examples:
- When visitor connects AND it’s first visit today → send bot welcome
- When unassigned for 60s → send bot wait message
- When offline and first message → send bot offline prompt
- When resolved → emit system event (always) and optionally send bot closing message

---

## Implementation Strategy (Minimize Risk)

Principles:
- Backwards compatible: old clients should continue to work.
- Start by deriving `actor/kind` from existing DB fields (no migration required initially).
- Migrate UI rendering to use `actor/kind` when available, but keep fallbacks.
- Only then introduce new Automation tables and move hardcoded messages into rules.

---

## Task Tracking (Granular)

### Phase 0 — Discovery (Done)
- [x] Identify message emitters and their wiring (welcome/wait/offline/resolve).
- [x] Verify DB schema only has visitor/agent/system sender types.
- [x] Identify payload mismatch: “resolved” persisted vs “closed” WS-only.

### Phase 1 — Canonical Message DTO (Backwards Compatible)
Why: stop guessing meaning from multiple fields.

- [x] Extend backend serialization to include derived `actor` and `kind` in the message DTO.
  - Derivation should be stable and not depend on client.
- [x] Keep existing fields (`sender_type`, `sender`, `event_type`) for older UIs.
- [x] Update widget + agent UI rendering to prefer `actor/kind` and fall back to old inference.

Acceptance:
- Existing conversations render exactly as before.
- New DTO includes actor/kind for all messages.

### Phase 2 — Resolve/Close Unification
Why: consistent behavior across DB + WS.

- [x] Replace WS-only “closed” message with a persisted + broadcasted system event.
- [ ] Standardize event types:
  - `conversation_resolved`
  - `conversation_reopened` (if/when we show it)
  - `agent_join` (existing)
- [x] Add optional per-website closing bot message setting.

Acceptance:
- Resolving a conversation produces one canonical event in history and live.
- No duplicate resolve messages across reconnect.

### Phase 3 — Automations Engine (MVP)
Why: move hardcoded bot messages into per-website rules.

- [x] Add tables for automations (per website): triggers, conditions, actions.
- [x] Implement MVP triggers:
  - visitor_connected
  - no_agent_assigned_for(duration) (wired)
  - website_offline_first_message (wired)
  - conversation_resolved (wired)
- [x] Implement MVP actions:
  - send_bot_chat_message
  - emit_system_event
- [x] Add caps/cooldowns to prevent spam.

- [x] Add minimal Automations API (list/create/update/delete).
- [x] Seed default automations for existing websites (waiting/offline/closing disabled).

Acceptance:
- Existing welcome/wait/offline flows are reproduced via rules.
- Behavior can be disabled/edited per website.

### Phase 4 — Smartsupp-like UI (Foundations)
Why: admins need a structured place to control behavior.

- [x] Add per-website Automations area:
  - Templates
  - Auto messages
  - Chatbots (future)
- [x] Build “Build from scratch” slide-over (Chatbot / Auto message / AI assistant).
- [x] Settings layout consistent with Smartsupp: When / Where / Audience / Scheduling / Behavior.

Acceptance:
- Admin can enable/disable and edit welcome/wait/offline/close message texts per website.

### Phase 5 — Migration & Cleanup
Why: reduce long-term complexity.

- [x] Map existing widget_config.automations into new Automation rows.
- [x] Deprecate transport name `type:"ai"` for non-AI; introduce neutral names or include actor/kind.
- [x] Remove hardcoded bot messages from orchestrator/WS layer (after parity is confirmed).

---

## Non-Goals (Explicit)
- Implementing the full chatbot flow builder in the same PR as the taxonomy refactor.
- Shipping AI responses; AI is future work and must remain distinct.
- Rewriting all UI to a new design system.

---

## Risks & Mitigations
- Risk: breaking older widget/agent dashboards.
  - Mitigation: keep backward-compatible fields and add actor/kind as additive.
- Risk: duplicate automated messages (reconnect, multi-worker).
  - Mitigation: cooldown + idempotency keys per automation/run.
- Risk: scope creep.
  - Mitigation: MVP focuses on replacing existing hardcoded messages first.

---

## References (Existing Code Hotspots)
- backend/app/models/message.py (DB schema)
- backend/app/core/message_presenter.py (current bot/system presentation)
- backend/app/api/ws_chat.py (welcome automation)
- backend/app/services/conversation_orchestrator.py (waiting/offline; WS close)
- backend/app/services/conversation_service.py (persisted resolve message)
- frontend/src/pages/ConversationsView.tsx (agent UI rendering)
- widget/chat-widget.js (widget rendering)
