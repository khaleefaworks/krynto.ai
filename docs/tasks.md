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

**Fixed 2026-07-10**: REP1 (full audit — ratings_summary multi-tenant leak, IST timezone boundary bug in `_date_range`/`_avail_day_bounds`, inconsistent date-field usage across metrics, falsy-zero display bug, export column fixes, download-modal filter scoping/multi-select, inverted KPI color coding, and the Availability tab's missing Chat Arrivals / Missed Chats sections). See `backend/tests/test_analytics.py`.

No open items in this section right now.

## AI

| # | Title | Description | Priority |
|---|-------|-------------|----------|
| AI1 | **AI integration** | Not yet scoped — needs more thinking before this becomes an actionable item. Candidate directions to weigh: AI-drafted agent replies, auto-summarization of long conversations, an AI-first bot tier beyond the current rule-based automations, or ticket/intent classification. Revisit once there's a concrete first use case. | TBD |

## Automations

**Fixed 2026-07-16** (commit `a2d0531`): AUT1 (bot button clicks now resolve by a stable per-button id, minted at creation and self-healed on buttons saved before it existed, instead of array position — immune to reorders between send and click; a deleted-button click gets a graceful "no longer available" message instead of a silent no-op). Same commit also fixed two bugs found while validating it: a never-engaged conversation could still show "End chat" and trigger the rating-popup flow, and the "new chat unclaimed" reminder loop could resume for it after a restart; and the bot-typing `chatbot_pending` marker was hiding the message input for every bot message (including mid-conversation ones), with no reliable way back short of a reload. See `backend/tests/test_bot_button_id_resolution.py` and `backend/tests/test_new_chat_reminder_reconciliation.py`.

No open items in this section right now.

## Visitor Contact Capture

| # | Title | Description | Priority |
|---|-------|-------------|----------|
| CC1 | **Structured contact capture during a live (online) chat** | Today, contact info only gets captured cleanly when all agents are offline (structured form → `conversations.visitor_name/visitor_email/visitor_phone`, shown in `VisitorDetailsPanel`). When agents are online they just ask in chat, and visitors reply in free text ("ragul7708196644, Ragul, 7708196644") that nothing parses — agents have to manually retype it into the panel's edit fields. Decided approach: **agent-triggered inline "contact card"** in the chat thread (same industry-standard pattern as Intercom/Drift/Crisp's "collect visitor info" step), not regex-parsing free text (unreliable for phone/name, and a wrong silent auto-fill is worse than an empty field). Reuses a lot of existing plumbing: the `visitor_contact` WS message type already fills only-empty `conversations.visitor_*` columns (backend/app/api/ws_chat.py); the `bot_prompt_buttons` message type already proves the "enriched JSON message content, decoded by `message_presenter.py`, rendered as a real interactive widget instead of a text bubble" pattern; the offline contact-overlay's form UI/validation (name/phone digit-stripping/email regex) can be reused as the card's rendering; the agent-side trigger fits naturally next to the existing `/shortcut` mechanism in `ChatComposer.tsx` (e.g. a `/contact` trigger or a composer icon). New work: a new `event_type` for the card message, the widget-side renderer (smaller sibling of `appendBotPromptWithButtons`), and the agent trigger UI. Optional low-cost follow-up: a passive, non-committal "detected phone/email in recent messages — apply?" suggestion chip in the visitor panel as a backstop for agents who skip the card — never silently auto-filled. | Medium |

## Security

Found 2026-07-06: an agent can copy a visitor's `session_id` (visible as a full, untruncated tooltip + searchable text in `CustomersVisitors.tsx`) into their own browser's `ai_chatassist_session_id_{websiteId}` localStorage key and gain full read/write access to that visitor's conversation. Root cause: `session_id` is used as both the public identifier *and* the sole bearer credential for a conversation — classic identifier/secret conflation.

**Fixed 2026-07-09** (commit `72bc834`): SEC1 (expanded in scope beyond the original write-up — `chat_ws_with_conversation` wasn't just missing the domain lock, its history-send was completely unconditional on session ownership, so anyone who knew `website_id` + a small sequential `conversation_id` could read the full transcript regardless of `session_id`; both the domain lock and an ownership gate are now in place), SEC2, SEC4, and the connect/read-rate-limiting half of SEC5. Verified via real (not just syntax-checked) tests: mismatched session → rejected before any data sent, matching session → still works normally.

**Descoped 2026-07-16** (see `docs/archived/tasks.md`): SEC3 (separate session credential), SEC5's remaining idle-expiry piece, and SEC6 (silent-skip session checks + unauthenticated rating read) — all explicitly decided against, not deferred.

| # | Title | Description | Priority |
|---|-------|-------------|----------|
| SEC7 | **Stop exposing sequential Organization/Website IDs to customers** | `OrgSettings.tsx` and the Website Installation tab both display the raw integer `id` ("Org ID: 1", "Website ID: 1") to any Owner/Manager. Investigated whether this is exploitable like the earlier session_id issue — it isn't: `organization_id` is always derived server-side from the authenticated user's own session for regular endpoints, the one endpoint that accepts a client-supplied `org_id` (`/admin/organizations/{org_id}`) is already gated `SYSTEM_MANAGER`-only, and `website_id` is already fully public by design (embedded in every widget WS URL, visible via devtools on any customer site) with the real secret (`widget_key`, already a proper `secrets.token_hex(32)`) doing the actual access control. So this is **not** an access-control bug, just a business-info leak — a competitor watching the counter tick up learns roughly how many customers/sites you have. **Do not migrate the integer primary key to a UUID** — `organizations.id`/`websites.id` are foreign-keyed from nearly every table (users, conversations, teams, tags, ratings, page views, agent assignments...) plus every API response shape and frontend type; that's a large, genuinely risky migration for a cosmetic concern. Instead reuse the pattern already proven in this codebase: `Conversation.short_id` (`backend/app/models/conversation.py`) is exactly this — a separate random display identifier alongside the untouched integer PK used internally for joins. Add the same `short_id` column to `Organization`/`Website`, backfill existing rows with a one-time script, swap the two display spots to show it instead of `.id`. Purely additive — no FK changes, no cascade, nothing touching conversations/routing/the widget. | Low |

## Super Admin

**Closed 2026-07-16**: SA2 (Backup & Restore) — `pg_dump` + uploads backup to local disk, restore procedure, SYSTEM_MANAGER-gated, scheduled every 2h via the existing `AsyncIOScheduler` plus on-demand trigger, `SuperAdminBackups.tsx` UI. S3 offsite storage and at-rest encryption were considered and explicitly descoped — not wanted for this deployment.

| # | Title | Description | Priority |
|---|-------|-------------|----------|
| SA1 | **Flesh out the Super Admin (platform) dashboard** | `SuperAdminHome.tsx` is still a stub ("Organization management pages will live under /superadmin/*"), and `SuperAdminStats`/`SuperAdminOrgs` only show raw counts and a bare org list — no drill-down actions beyond org detail. Org suspend/reactivate (`is_active` toggle) already exists, but only from the org *detail* page (predates this branch, from Phase 4) — not from the list as originally asked. Still missing: plan/billing visibility, system health (WS connection counts, queue/job status, error rates), recent-signups/activity feed, and impersonation or support-login for debugging a tenant's issue. Scope out which of these are must-have vs. nice-to-have before building. | Medium |

## Audit Trail

| # | Title | Description | Priority |
|---|-------|-------------|----------|
| AU3 | **Change History / Audit Log** | No change-history mechanism exists. Implement an `audit_logs` table: `id, table_name, record_id, action (create/update/delete), performed_by_user_id, performed_at, old_values (JSONB), new_values (JSONB)`. Register SQLAlchemy `before_flush` event listener on `Base` to diff dirty instances automatically. Surface per-record history in the UI for key entities (conversations, users, automations, websites). Scope: track mutations on `users`, `websites`, `organizations`, `automations`, `website_teams`, `agent_website_assignments`. Read-heavy tables (messages, events) are excluded. | Low |
