# Tasks

## Carried Over from bugs&features.md

| # | Item | Notes |
|---|------|-------|
| 40 | **Mobile app — native** | PWA already exists and covers agents today. Native app is a future consideration only, no active plan. Would still require pnpm monorepo migration first — see `docs/MONOREPO_PLAN.md` |

---

## Integrations

| # | Title | Description | Priority |
|---|-------|-------------|----------|
| INT1 | **Third-party integrations (CRM, webhooks, etc.)** | Outbound webhooks for key events (new conversation, resolved, contact captured) so customers can wire their own CRM (HubSpot, Salesforce, Pipedrive) without a bespoke integration per customer. Check what established competitors ship as a baseline before scoping: Chatwoot offers signed-payload webhooks + a full REST API, native Slack integration (handle conversations from Slack), Shopify (order history surfaced in-panel), and Dialogflow/Rasa/Lex hookups for bot handoff to agents. Decide which of these are worth building here — generic webhooks are the obvious first cut, e-commerce/Slack passthrough lower priority — and whether any other competitor (Crisp, Intercom, Tidio) has an integration pattern worth copying. | Medium |

## Analytics

| # | Title | Description | Priority |
|---|-------|-------------|----------|
| REP1 | **Analytics UI & calculation overhaul** | Broader than the original timing-accuracy report: revisit the Analytics section end to end — UI/layout and correctness of the underlying calculations. Known issue: conversation `created_at`/`resolved_at` and other lifecycle timestamps aren't accurate, throwing off duration metrics; audit the full metric pipeline while in there, not just the timestamps. | Medium |

## AI

| # | Title | Description | Priority |
|---|-------|-------------|----------|
| AI1 | **AI integration** | Not yet scoped — needs more thinking before this becomes an actionable item. Candidate directions to weigh: AI-drafted agent replies, auto-summarization of long conversations, an AI-first bot tier beyond the current rule-based automations, or ticket/intent classification. Revisit once there's a concrete first use case. | TBD |

## Visitor Contact Capture

| # | Title | Description | Priority |
|---|-------|-------------|----------|
| CC1 | **Structured contact capture during a live (online) chat** | Today, contact info only gets captured cleanly when all agents are offline (structured form → `conversations.visitor_name/visitor_email/visitor_phone`, shown in `VisitorDetailsPanel`). When agents are online they just ask in chat, and visitors reply in free text ("ragul7708196644, Ragul, 7708196644") that nothing parses — agents have to manually retype it into the panel's edit fields. Decided approach: **agent-triggered inline "contact card"** in the chat thread (same industry-standard pattern as Intercom/Drift/Crisp's "collect visitor info" step), not regex-parsing free text (unreliable for phone/name, and a wrong silent auto-fill is worse than an empty field). Reuses a lot of existing plumbing: the `visitor_contact` WS message type already fills only-empty `conversations.visitor_*` columns (backend/app/api/ws_chat.py); the `bot_prompt_buttons` message type already proves the "enriched JSON message content, decoded by `message_presenter.py`, rendered as a real interactive widget instead of a text bubble" pattern; the offline contact-overlay's form UI/validation (name/phone digit-stripping/email regex) can be reused as the card's rendering; the agent-side trigger fits naturally next to the existing `/shortcut` mechanism in `ChatComposer.tsx` (e.g. a `/contact` trigger or a composer icon). New work: a new `event_type` for the card message, the widget-side renderer (smaller sibling of `appendBotPromptWithButtons`), and the agent trigger UI. Optional low-cost follow-up: a passive, non-committal "detected phone/email in recent messages — apply?" suggestion chip in the visitor panel as a backstop for agents who skip the card — never silently auto-filled. | Medium |

## Security

Found 2026-07-06: an agent can copy a visitor's `session_id` (visible as a full, untruncated tooltip + searchable text in `CustomersVisitors.tsx`) into their own browser's `ai_chatassist_session_id_{websiteId}` localStorage key and gain full read/write access to that visitor's conversation. Root cause: `session_id` is used as both the public identifier *and* the sole bearer credential for a conversation — classic identifier/secret conflation.

**Fixed 2026-07-09** (commit `72bc834`): SEC1 (expanded in scope beyond the original write-up — `chat_ws_with_conversation` wasn't just missing the domain lock, its history-send was completely unconditional on session ownership, so anyone who knew `website_id` + a small sequential `conversation_id` could read the full transcript regardless of `session_id`; both the domain lock and an ownership gate are now in place), SEC2, SEC4, and the connect/read-rate-limiting half of SEC5. Verified via real (not just syntax-checked) tests: mismatched session → rejected before any data sent, matching session → still works normally. Remaining below.

| # | Title | Description | Priority |
|---|-------|-------------|----------|
| SEC3 | **Separate session identifier from session credential** | The actual structural fix. Generate a second random secret alongside `session_id` at first connect, store both in the widget's localStorage entry, and require *both* (not just session_id) to open a WS or read history. Never return the secret in any agent-facing API response. `session_id` is trusted as the sole credential across 2 WS routes and 5 REST routes today — a real fix means threading the secret through all of them at once, plus a soft-migration path so no currently-connected live visitor gets locked out (issue a secret transparently on first connect if one's missing, only start hard-rejecting once one has actually been issued). Real auth-model change — scope as its own piece of work. | Medium |
| SEC5 | **Add session idle-expiry** | Connect/read rate-limiting shipped 2026-07-09 (IP-keyed, fails open if Redis is down). Remaining: a leaked/idle session_id never expires. Note: the "24h inactivity auto-close" precedent originally cited here is dead code — `_run_auto_close`/`_run_auto_resolve_visitor_ended` in `auto_close_scheduler.py` are never registered with the live APScheduler instance (only two unrelated notification jobs are). Building this means designing fresh expiry semantics, not reviving an existing job — natural to pair with SEC3 since both touch "what makes a session still valid." | Low |
| SEC6 | **Fix silent-skip session checks + unauthenticated rating read** | Surfaced while investigating SEC1-5, not yet fixed. `POST /ratings/submit` and the forms-submission route (`backend/app/api/forms.py`) only cross-check `session_id` against the conversation *if the field is supplied at all* — omitting it skips the check entirely, worse than blind trust. Separately, `GET /widget/conversations/{conversation_id}/rating` (`widget.py`) has no session_id/website check whatsoever — any conversation's rating is readable by ID alone. | Medium |

## Super Admin

| # | Title | Description | Priority |
|---|-------|-------------|----------|
| SA1 | **Flesh out the Super Admin (platform) dashboard** | `SuperAdminHome.tsx` is still a stub ("Organization management pages will live under /superadmin/*"), and `SuperAdminStats`/`SuperAdminOrgs` only show raw counts and a bare org list — no drill-down actions beyond org detail. Needs the operational features a platform admin actually reaches for: org lifecycle actions (suspend/reactivate/verify from the list, not just view), plan/billing visibility, system health (WS connection counts, queue/job status, error rates), recent-signups/activity feed, and impersonation or support-login for debugging a tenant's issue. Scope out which of these are must-have vs. nice-to-have before building. | Medium |

## Audit Trail

| # | Title | Description | Priority |
|---|-------|-------------|----------|
| AU3 | **Change History / Audit Log** | No change-history mechanism exists. Implement an `audit_logs` table: `id, table_name, record_id, action (create/update/delete), performed_by_user_id, performed_at, old_values (JSONB), new_values (JSONB)`. Register SQLAlchemy `before_flush` event listener on `Base` to diff dirty instances automatically. Surface per-record history in the UI for key entities (conversations, users, automations, websites). Scope: track mutations on `users`, `websites`, `organizations`, `automations`, `website_teams`, `agent_website_assignments`. Read-heavy tables (messages, events) are excluded. | Low |
