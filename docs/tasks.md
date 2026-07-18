# Tasks

## Carried Over from bugs&features.md

| # | Item | Notes |
|---|------|-------|
| 40 | **Mobile app — native** | PWA already exists and covers agents today. Native app is a future consideration only, no active plan. Would still require pnpm monorepo migration first — see `docs/MONOREPO_PLAN.md` |

---

## Integrations

**Closed 2026-07-18** (see `docs/archived/tasks.md`): INT1 lead-capture webhook slice (generic outbound webhooks, retry/backoff, delivery audit trail) + gap-fill (manual lead resend/status, per-form routing, `lead_delivered` automation trigger). Remaining originally-listed items (other-event webhooks, native Slack, Shopify, Dialogflow/Rasa/Lex) explicitly descoped, not deferred.

No open items in this section right now.

## Analytics

**Fixed 2026-07-10** (see `docs/archived/tasks.md`): REP1 — full audit (multi-tenant leak, IST timezone bugs, export/filter fixes, inverted KPI color coding, missing Availability sections).

No open items in this section right now.

## AI

| # | Title | Description | Priority |
|---|-------|-------------|----------|
| AI1 | **AI integration** | Not yet scoped — needs more thinking before this becomes an actionable item. Candidate directions to weigh: AI-drafted agent replies, auto-summarization of long conversations, an AI-first bot tier beyond the current rule-based automations, or ticket/intent classification. Revisit once there's a concrete first use case. | TBD |

## Automations

**Fixed 2026-07-16** (commit `a2d0531`, see `docs/archived/tasks.md`): AUT1 — bot button clicks resolve by a stable per-button id instead of array position, plus two related bugs found while validating it (stale "End chat"/rating-popup flow on never-engaged conversations, bot-typing marker hiding the message input).

No open items in this section right now.

## Visitor Contact Capture

**Fixed 2026-07-18** (commit `5fb6da9`, see `docs/archived/tasks.md`): CC1 — agent-triggered inline contact card from the composer, live pending/filled/expired state, offline-gate extra fields with per-field type/required-ness, shared international phone input.

No open items in this section right now.

## Security

Found 2026-07-06: an agent can copy a visitor's `session_id` (visible as a full, untruncated tooltip + searchable text in `CustomersVisitors.tsx`) into their own browser's `ai_chatassist_session_id_{websiteId}` localStorage key and gain full read/write access to that visitor's conversation. Root cause: `session_id` is used as both the public identifier *and* the sole bearer credential for a conversation — classic identifier/secret conflation.

**Fixed 2026-07-09** (commit `72bc834`, see `docs/archived/tasks.md`): SEC1 (domain lock + ownership gate on `chat_ws_with_conversation`, which previously sent full transcript history unconditionally), SEC2, SEC4, and the connect/read-rate-limiting half of SEC5.

**Descoped 2026-07-16** (see `docs/archived/tasks.md`): SEC3 (separate session credential), SEC5's remaining idle-expiry piece, and SEC6 (silent-skip session checks + unauthenticated rating read) — all explicitly decided against, not deferred.

| # | Title | Description | Priority |
|---|-------|-------------|----------|
| SEC7 | **Stop exposing sequential Organization/Website IDs to customers** | `OrgSettings.tsx` and the Website Installation tab both display the raw integer `id` ("Org ID: 1", "Website ID: 1") to any Owner/Manager. Investigated whether this is exploitable like the earlier session_id issue — it isn't: `organization_id` is always derived server-side from the authenticated user's own session for regular endpoints, the one endpoint that accepts a client-supplied `org_id` (`/admin/organizations/{org_id}`) is already gated `SYSTEM_MANAGER`-only, and `website_id` is already fully public by design (embedded in every widget WS URL, visible via devtools on any customer site) with the real secret (`widget_key`, already a proper `secrets.token_hex(32)`) doing the actual access control. So this is **not** an access-control bug, just a business-info leak — a competitor watching the counter tick up learns roughly how many customers/sites you have. **Do not migrate the integer primary key to a UUID** — `organizations.id`/`websites.id` are foreign-keyed from nearly every table (users, conversations, teams, tags, ratings, page views, agent assignments...) plus every API response shape and frontend type; that's a large, genuinely risky migration for a cosmetic concern. Instead reuse the pattern already proven in this codebase: `Conversation.short_id` (`backend/app/models/conversation.py`) is exactly this — a separate random display identifier alongside the untouched integer PK used internally for joins. Add the same `short_id` column to `Organization`/`Website`, backfill existing rows with a one-time script, swap the two display spots to show it instead of `.id`. Purely additive — no FK changes, no cascade, nothing touching conversations/routing/the widget. | Low |

## Super Admin

**Closed 2026-07-16** (see `docs/archived/tasks.md`): SA2 — Backup & Restore (`pg_dump` + uploads, restore procedure, scheduled + on-demand, `SuperAdminBackups.tsx` UI). S3 offsite storage and at-rest encryption explicitly descoped.

| # | Title | Description | Priority |
|---|-------|-------------|----------|
| SA1 | **Flesh out the Super Admin (platform) dashboard** | `SuperAdminHome.tsx` is still a stub ("Organization management pages will live under /superadmin/*"), and `SuperAdminStats`/`SuperAdminOrgs` only show raw counts and a bare org list — no drill-down actions beyond org detail. Org suspend/reactivate (`is_active` toggle) already exists, but only from the org *detail* page (predates this branch, from Phase 4) — not from the list as originally asked. Still missing: plan/billing visibility, system health (WS connection counts, queue/job status, error rates), recent-signups/activity feed, and impersonation or support-login for debugging a tenant's issue. Scope out which of these are must-have vs. nice-to-have before building. **Scoped 2026-07-18 — see `docs/SA1_AU3_PLAN.md`** for current-state findings (what's dead code, what's cheap to surface vs a real new build) and a prioritized cheap-wins-vs-bigger-builds breakdown. | Medium |

## Audit Trail

| # | Title | Description | Priority |
|---|-------|-------------|----------|
| AU3 | **Change History / Audit Log** | No change-history mechanism exists. Implement an `audit_logs` table: `id, table_name, record_id, action (create/update/delete), performed_by_user_id, performed_at, old_values (JSONB), new_values (JSONB)`. Register SQLAlchemy `before_flush` event listener on `Base` to diff dirty instances automatically. Surface per-record history in the UI for key entities (conversations, users, automations, websites). Scope: track mutations on `users`, `websites`, `organizations`, `automations`, `website_teams`, `agent_website_assignments`. Read-heavy tables (messages, events) are excluded. **Scoped 2026-07-18 — see `docs/SA1_AU3_PLAN.md`** for current-state findings (confirmed zero tracking exists anywhere, including in the security-critical paths — login lockouts and role changes are completely silent today) and a phased plan: a small event-based `security_events` log first (covers "at least security"), the heavier generic before_flush diffing above deferred to a later phase. | Low |
