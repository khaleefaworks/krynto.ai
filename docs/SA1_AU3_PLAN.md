# SA1 (Super Admin dashboard) + AU3 (Audit trail) — action plan

Scoping notes from 2026-07-18. Nothing below is implemented yet — this is the
plan to execute in a follow-up session. Referenced from `docs/tasks.md`'s
Super Admin and Audit Trail sections.

Recommended build order: **AU3 Phase 1 first** — it's small, self-contained,
and both of SA1's bigger items (recent-signups/activity feed, impersonation)
are meaningfully easier once there's somewhere to log events to. SA1's cheap
wins have no dependency on AU3 and can be done in either order/in parallel.

---

## Current-state findings (research done 2026-07-18)

### Super Admin dashboard
- `frontend/src/pages/SuperAdminHome.tsx` is **dead code** — not referenced
  anywhere in `App.tsx`'s routes. `/superadmin` redirects straight to
  `organizations`. Either wire it up as the real landing page or delete it.
- `SuperAdminStats.tsx` — fully built, single live snapshot (4 cards: orgs,
  users, websites, conversations), manual refresh only, no trends.
- `SuperAdminOrgs.tsx` — fully built list page, but read-only/navigation
  only: no search/filter/sort, no pagination, no create-org action.
- `SuperAdminOrgDetail.tsx` — fully built. Only two mutable fields: `plan`
  (free/pro/enterprise dropdown) and `is_active` (suspend/reactivate
  toggle), both **only editable here**, not from the list page. No user
  list, no per-org website list, no activity/audit info, no billing
  history.
- `SuperAdminBackups.tsx` — most mature page already (list/create/download/
  restore backups with polling and version-compatibility warnings).
- Backend: `backend/app/api/admin.py`, all `SYSTEM_MANAGER`-gated
  (`require_administrator`, `deps.py:134-138`):
  - `GET /admin/organizations`, `GET /admin/organizations/{id}`,
    `PATCH /admin/organizations/{id}` (plan/is_active/name)
  - `GET /admin/stats` (platform totals)
  - `GET /admin/users` — **exists but has no frontend page at all**, dead/
    unused endpoint today.
- System-health data that's already tracked but not surfaced anywhere:
  - `AgentService.active_agents` (in-memory dict) → live agent WS
    connection count (`backend/app/services/agent_service.py:29`)
  - `PresenceService._connections` → live visitor count per website
    (`backend/app/services/presence_service.py:29`)
  - APScheduler's own job store, jobs registered in
    `auto_close_scheduler.py:161-247` (notification retry, notification
    cleanup, scheduled backup, lead-delivery retry) → job status/next-run
  - `backend/app/api/health.py:28-69` (`/health/ready`) already checks DB +
    Redis connectivity — just needs a dashboard tile, not new checks.
- `Organization.plan` (`backend/app/models/organization.py:24`) is a plain
  string label only — no price, no Stripe/customer ID, no invoice history,
  no plan-limit enforcement anywhere. "Billing visibility" means building
  real billing, not surfacing existing data.
- Impersonation/support-login: **nothing exists anywhere** in the codebase
  (checked backend + frontend). Fully greenfield.

### Audit trail
- Confirmed: **no** audit/version/history table or mechanism anywhere.
  Grepped `audit|history|version|activity_log|change_log` across
  `backend/app/models/` and `backend/app/services/` — every hit is a false
  positive (notification delivery "audit trail," chat message "history,"
  Alembic schema "version," widget "history reload").
- `backend/app/core/logging.py:7-33` — structlog, JSON-formatted, but
  **stdout only**, no file/DB sink. `logging_middleware.py:38-78` logs per-
  request events, but none of it is persisted or queryable later.
- Security-sensitive spots are the most silent, not just "unlogged in
  general":
  - Login lockout (`backend/app/api/auth.py:267-321`,
    `User.failed_login_attempts`/`temp_lockout_until`) mutates DB fields on
    every attempt with **zero `logger.*` calls anywhere in `auth.py`** —
    prior attempt history is silently overwritten, no trail at all.
  - Role changes (`backend/app/api/users.py:428-561`) compute `old_role`
    locally (line ~560) and then **discard it** — never logged, never
    persisted.
  - Org suspension: no dedicated event, only the current-state
    `Organization.is_active` flag flips with no logging observed.
  - No API-key/secret-rotation concept exists in the app's own data model.
- Implicit "who/when" that already exists and can be reused:
  - `UserLoginSession` (jti, ip_address, user_agent, is_active,
    last_used_at, revoked_at) — closest thing to a real login/session audit
    trail today, but has no failure records.
  - `ConversationNote.created_by`, `ConversationTag.created_by` — only two
    models anywhere with an actor FK; everything else is bare timestamps.
- SQLAlchemy `before_flush`/session events: **zero usage** anywhere in this
  codebase today. The original AU3 write-up's proposed mechanism (global
  `before_flush` diffing) would be a wholly new pattern, not an extension of
  something already proven here.

---

## AU3 plan

Two distinct layers exist in Frappe that don't exist here at all:
`Version` (automatic field-level diff per save, opt-in per doctype) and
`Activity Log`/`Access Log` (discrete named events — login, permission
change, etc.). Build the lighter, event-based layer first.

### Phase 1 — security/activity event log (build this first)

New table, event-based (not field-diffing):

```
security_events
  id
  event_type          (e.g. "login_failed", "login_lockout", "login_success",
                        "password_changed", "role_changed", "user_activated",
                        "user_deactivated", "org_suspended", "org_reactivated",
                        "org_plan_changed")
  actor_user_id        (nullable — null for e.g. an unauthenticated failed login)
  target_user_id        (nullable — who was acted on, if different from actor)
  organization_id       (nullable)
  ip_address
  metadata              (JSON — e.g. {"old_role": "agent", "new_role": "manager"})
  created_at
```

A small `log_security_event(db, *, event_type, actor_user_id=None,
target_user_id=None, organization_id=None, ip_address=None, metadata=None)`
helper, called from the exact silent points found above:
- `backend/app/api/auth.py` — failed login attempt, lockout threshold
  crossed (temp/24h), successful login, password change
- `backend/app/api/users.py` — role change (persist the `old_role` it
  already computes instead of discarding it), user activate/deactivate
- `backend/app/api/admin.py` — org suspend/reactivate, plan change

UI: one new Super Admin tab ("Security Log" or "Activity Log") — a
filterable table (org, event type, actor, date range). Reuse the existing
list+filter pattern already used elsewhere in this app (e.g. the Contacts
page) rather than inventing a new one.

### Phase 2 — generic change diffing (defer)

The original AU3 spec: `audit_logs` table (`old_values`/`new_values` JSONB)
+ a SQLAlchemy `before_flush` listener on `Base`, scoped to `users`,
`websites`, `organizations`, `automations`, `website_teams`,
`agent_website_assignments` (read-heavy tables like messages/events
excluded). This is the actual equivalent of Frappe's `Version` doctype —
architecturally heavier (global ORM hook, needs care around noisy fields
like `updated_at` itself polluting every diff). Worth doing only once
Phase 1's event log proves insufficient — i.e. admins start asking "what
exactly changed on this record," not just "who did X and when."

---

## SA1 plan

### Cheap wins (reuse data that already exists, no new instrumentation)
1. Wire `SuperAdminHome.tsx` into the router as the real landing page, or
   delete it — currently unreachable dead code.
2. Build a platform-wide Users page/tab using the already-existing
   `GET /admin/users` endpoint (currently has zero frontend consumer).
3. Add search/filter/sort + pagination to `SuperAdminOrgs.tsx`.
4. Add suspend/reactivate directly from the org list page, not just detail.
5. Surface system health as dashboard tiles from data that's already
   tracked in memory/via existing endpoints: live agent WS connection
   count, live visitor count, scheduler job status/next-run, `/health/ready`
   DB+Redis status. No new instrumentation needed, just new read endpoints
   (thin wrappers) + UI.
6. Turn `SuperAdminStats.tsx` into a trend view (daily deltas) instead of a
   single snapshot — moderate step up, not a rebuild.

### Bigger builds (real new scope)
7. **Billing visibility** — `Organization.plan` is just a label today; this
   means building actual billing (Stripe or similar), not exposing existing
   data. Confirm this is really wanted before scoping further.
8. **Recent-signups/activity feed** — do this after AU3 Phase 1 exists;
   trivial once events are logged somewhere queryable, awkward before.
9. **Impersonation/support-login** — greenfield, security-sensitive. Should
   not ship without its own audit trail (who impersonated whom, when, what
   they touched) — build on top of AU3 Phase 1's `security_events` table
   rather than inventing a separate logging path for it.
