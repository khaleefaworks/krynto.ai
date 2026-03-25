# SaaS Refactor & Conversation Architecture Plan

Single source of truth for the two parallel tracks of major work:
1. **Multi-Tenant SaaS** — converting the single-tenant app into a proper SaaS product
2. **Conversation/Session Refactor** — decoupling session identity from conversations so a visitor can have multiple conversations, with a tawk.to-style history list in the widget

Nothing here is implemented yet. This document is the architecture reference before coding begins.

---

## Part A: Clarifications Before We Start

### A1. "Can migrate to schema-per-tenant later"

Schema-per-tenant means each organisation gets its own PostgreSQL schema (like `acme.users`, `acme.websites`) instead of sharing the `public` schema with an `organization_id` column. It gives stronger data isolation at the DB level and makes it trivial to dump/restore one tenant's data independently.

It is significantly harder to operate: migrations must run per-schema, connection pooling is tricky, Alembic doesn't support it out of the box. For our current stack and scale, **shared DB with `organization_id` row-level scoping is the right choice**. The note simply means the architecture is not painted into a corner — if a future enterprise customer contractually requires data isolation, the data model can be migrated. Ignore it for now.

### A2. Should Administrator have a different UI?

No. The `SYSTEM_MANAGER` (Administrator / super-admin) should have a **completely separate interface** — `/superadmin/*` — not the regular agent dashboard. Their job is platform management, not chat support. They should never see the agent chat inbox at all. The regular `/dashboard/*` tree remains for `OWNER`, `MANAGER`, and `AGENT` roles only.

### A3. Migration — Not Needed

The application is not live. The clean path is:
- Run `reset_application.py` to wipe the DB
- Run Alembic migrations for the new schema from scratch
- Seed any test data with `reset_application.py --seed`

No backward-compat data migration scripts needed at all.

### A4. Remove the Reset Application Page

The frontend `/dashboard/reset` page and its API endpoint (`POST /system/reset`) must be removed. The only reset path is the CLI script `backend/reset_application.py`. Once clients are onboarded, the concept of a full platform reset becomes meaningless — future "reset" will be org-scoped (e.g., an org owner wiping their own data).

**Things to remove:**
- `frontend/src/pages/ResetApplication.tsx` (the page component)
- The `/dashboard/reset` route in `frontend/src/App.tsx`
- The `import ResetApplication` line in `App.tsx`
- `backend/app/api/system.py` (the `POST /system/reset` API endpoint)
- The `system` router registration in `backend/app/main.py`

---

## Part B: Multi-Tenant SaaS Architecture

### B1. Core Principle

Shared PostgreSQL database with `organization_id` row-level scoping on every resource. No schema-per-tenant. Existing Alembic + SQLAlchemy tooling works unchanged.

### B2. Role Redesign

Current `UserRole` enum: `SYSTEM_MANAGER | MANAGER | AGENT`

New `UserRole` enum:

| Role | Scope | What They Can Do |
|------|-------|-----------------|
| `SYSTEM_MANAGER` | Platform-wide | Sees all orgs; platform stats; activate/deactivate orgs; impersonate. `organization_id = NULL`. |
| `OWNER` | Within their org | Full control of their org: create websites, invite users, change org settings, see analytics. Created automatically on signup. |
| `MANAGER` | Within their org | Create/manage websites, users, automations. Cannot delete the org or transfer ownership. |
| `AGENT` | Within their org | Claim chats, personal shortcuts. Sees only assigned websites. |

Helper method changes on `User`:

```python
def is_superadmin(self) -> bool:
    return self.role == UserRole.SYSTEM_MANAGER

def is_org_owner(self) -> bool:
    return self.role == UserRole.OWNER

def is_admin(self) -> bool:  # replaces current
    return self.role in [UserRole.SYSTEM_MANAGER, UserRole.OWNER, UserRole.MANAGER]

def is_administrator(self) -> bool:  # unchanged semantic
    return self.role == UserRole.SYSTEM_MANAGER
```

### B3. New Data Models

#### `organizations` table

```python
class Organization(Base, TimestampMixin):
    __tablename__ = "organizations"

    id          = Column(Integer, primary_key=True)
    name        = Column(String(255), nullable=False)
    slug        = Column(String(100), unique=True, nullable=False)  # URL-safe, e.g. "acme-corp"
    owner_id    = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    plan        = Column(String(50), default="free")   # "free" | "pro" | "enterprise"
    is_active   = Column(Boolean, default=True)
    settings    = Column(JSON, nullable=True)          # per-org config (office hours, limits, etc.)

    # Relationships
    users    → List[User]
    websites → List[Website]
    owner    → User
```

Why `slug`? Used in team invite URLs and the super-admin UI. Auto-generated from org name at signup; unique-checked.

#### Changes to `users`

```sql
ALTER TABLE users ADD COLUMN organization_id INTEGER REFERENCES organizations(id) ON DELETE SET NULL;
-- SYSTEM_MANAGER gets organization_id = NULL (no org restriction)
-- OWNER gets the org they created
-- MANAGER/AGENT get the org they were invited into
```

Also add `OWNER` to the `UserRole` enum.

#### Changes to `websites`

```sql
ALTER TABLE websites ADD COLUMN organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE;
-- CASCADE: deleting an org wipes its websites (and, transitively, all conversations)
```

#### No changes to downstream models

`Conversation`, `Message`, `Tag`, `Automation`, `WebsiteTeam`, `AgentWebsiteAssignment`, `MessageShortcut` — all already scoped under `website_id`. Since `website_id` is now scoped under `organization_id`, the chain is complete without touching them.

`SystemSettings` — stays as-is. Platform-level initialization flag and token invalidation timestamp.

### B4. JWT Changes

Current payload:
```json
{ "sub": "user", "user_id": 42, "email": "x@y.com", "role": "manager", "exp": ..., "iat": ... }
```

New payload:
```json
{ "sub": "user", "user_id": 42, "email": "x@y.com", "role": "owner", "organization_id": 7, "exp": ..., "iat": ... }
```

- `organization_id: null` for `SYSTEM_MANAGER`
- Enables fast boundary filtering without a DB round-trip per request
- For sensitive mutations (password change, user management), the claim must be verified against the DB, never blindly trusted

### B5. New Dependency Functions

```python
def require_org_admin(current_user: User):
    """OWNER or MANAGER within an org. SYSTEM_MANAGER also passes."""
    if current_user.role not in [OWNER, MANAGER, SYSTEM_MANAGER]:
        raise HTTPException(403)

def require_org_owner(current_user: User):
    """Only the org OWNER (or SYSTEM_MANAGER) can do this."""
    if current_user.role not in [OWNER, SYSTEM_MANAGER]:
        raise HTTPException(403)

def get_org_scope(current_user: User) -> int | None:
    """Returns organization_id for boundary filtering. None = unrestricted (super-admin)."""
    if current_user.is_superadmin():
        return None
    return current_user.organization_id
```

Every endpoint that reads org-scoped resources calls `get_org_scope()`:

```python
org_id = get_org_scope(current_user)
query = db.query(Website)
if org_id is not None:
    query = query.filter(Website.organization_id == org_id)
```

### B5a. Security Features

> **Email OTP Verification on Signup (V1 — implement now):** After signup, user must enter a 6-digit OTP to verify their email before the JWT is issued. Flow: signup form → `{ needs_verification: true }` response → OTP entry step → `POST /auth/verify-otp` → JWT issued → `/dashboard/chats`.
>
> **Resend test-mode override:** Resend's shared domain (`onboarding@resend.dev`) can only deliver to the verified Resend account email. Set env var `RESEND_OVERRIDE_TO_EMAIL=novelwebdevelopers@gmail.com`. When this var is set, all outgoing emails (OTP, password reset, welcome) are redirected to that address regardless of actual recipient. When a custom domain is verified in Resend, remove this env var and emails go to real addresses.
>
> **New model: `EmailOTP`** — stores `user_id`, `otp_hash` (SHA-256 of 6-digit code), `expires_at` (15 min), `used_at`. Never store the raw OTP. Single-use.
>
> **New endpoint:** `POST /auth/verify-otp` — body: `{ email, otp }`. Hashes OTP, looks up unused/unexpired token, marks used, sets `user.is_email_verified = True`, returns JWT.
>
> **`is_email_verified` column on `User`** (default `False`). `get_current_user` does NOT block unverified users (they can only call `/auth/verify-otp` and `/auth/logout`). JWT is only issued after OTP is verified.
>
> **User Invite Email Verification (V2):** When an Owner adds a new user to their org, the system should send a verification email. Deferred — invited users can log in immediately for now.

> **Multiple Owners per Org:** Allowed. An org can have more than one OWNER — this prevents lockout if a sole owner leaves. The OWNER role grants full control within the org (create/delete users and websites, org settings). Only an existing OWNER (or SYSTEM_MANAGER) can grant or revoke the OWNER role. Managers cannot promote to OWNER.

### B5b. Role Management UI Rules

The `SYSTEM_MANAGER` role is a platform-level bootstrap account, not an org-level role. It must **never** appear in the dashboard role dropdown or any org user management UI:
- `AgentsList.tsx` role dropdown: `owner | manager | agent` only
- `PATCH /users/{id}/role` must reject any attempt to assign `system_manager` to an existing non-system-manager user
- `POST /auth/register` must reject `role=system_manager` unconditionally (SYSTEM_MANAGER is only created via bootstrap)

### B5c. Known Gaps To Fix

| Gap | Description | Severity | Location |
|-----|-------------|----------|----------|
| E | OWNER receives no WS chat notifications (treated as AGENT — gets empty `visible_website_ids` from assignment table, which is empty for owners) | **Critical** | `agent_service.py` `register_agent()` |
| B | MANAGER can promote any user to OWNER via `PATCH /users/{id}/role` | High | `users.py` |
| C | MANAGER can create OWNER-role users via `POST /auth/register` | High | `auth.py` |
| D | `system_manager` appears in AgentsList role dropdown; `owner` does not | Medium | `AgentsList.tsx` |
| F | Push notification URL uses `session_id` instead of `conversation_id` | Medium | `conversation_orchestrator.py` |
| A | MANAGER can update websites they are not assigned to | Medium | `websites.py` |

### B6. Onboarding Flow

#### Public Signup (new)

```
POST /auth/signup
{
  "name": "Alice",
  "email": "alice@acme.com",
  "password": "...",
  "organization_name": "Acme Corp"
}
```

Server (atomic transaction):
1. Validate email uniqueness
2. Auto-generate `slug` from org name (slugify + uniqueness suffix if needed)
3. Create `Organization` (plan=free, is_active=true)
4. Create `User` (role=OWNER, organization_id=new org)
5. Set `org.owner_id = user.id`
6. Return JWT (same shape as login response)
7. Redirect to `/dashboard/chats` — org is ready immediately, no approval step

#### Platform Bootstrap (unchanged structure)

```
POST /auth/bootstrap
```

Still one-time-only. Creates the single `SYSTEM_MANAGER`. `organization_id = NULL`. Only accessible at `/setup` when `is_initialized = false`.

#### Admin Invites Users (updated)

```
POST /auth/register   (require_org_admin)
```

When an OWNER/MANAGER creates a user, the new user automatically inherits `organization_id` from the creating user. A `SYSTEM_MANAGER` calling this endpoint must specify `organization_id` in the request body.

### B7. New API Endpoints

#### Org management (scoped to current user's org)

```
GET     /organization              → Get current user's org details
PATCH   /organization              → Update org name/settings (OWNER only)
GET     /organization/members      → List org users
DELETE  /organization              → Delete org + cascade (OWNER only, requires confirmation)
```

#### Super-admin panel (SYSTEM_MANAGER only)

```
GET     /admin/organizations              → List all orgs with stats (user count, website count, plan)
GET     /admin/organizations/{id}         → Org detail
PATCH   /admin/organizations/{id}         → Update plan, activate/deactivate
GET     /admin/users                      → All users across all orgs
GET     /admin/stats                      → Platform-wide metrics
POST    /admin/organizations/{id}/token   → Issue a short-lived (60s) org-scoped JWT for impersonation (server-logged)
```

### B8. Visibility Scoping Update

Current `compute_visibility_scope()` in `visibility.py` returns a `VisibilityScope` with just `website_ids`.

Enhanced:

```python
@dataclass
class VisibilityScope:
    organization_id: int | None    # None = no org restriction (super-admin)
    website_ids: list[int] | None  # None = all websites in org; list = restricted set

def compute_visibility_scope(db, user) -> VisibilityScope:
    if user.is_superadmin():
        return VisibilityScope(organization_id=None, website_ids=None)

    scope = VisibilityScope(organization_id=user.organization_id)

    if user.is_admin():  # OWNER or MANAGER
        scope.website_ids = None  # see all websites within their org
    else:  # AGENT
        rows = db.query(AgentWebsiteAssignment.website_id)\
            .filter(AgentWebsiteAssignment.agent_id == user.id).all()
        scope.website_ids = [r[0] for r in rows]

    return scope
```

### B9. Frontend Changes

#### New pages

| Page | Route | Who | Purpose |
|------|-------|-----|---------|
| `SignupPage` | `/signup` | Public | Name, email, password, org name. CTA: "Create a free account". Login link: "Sign up for free". **V2: Add Google OAuth button** (deferred — no social login in V1) |
| `SuperAdminLayout` | `/superadmin` | SYSTEM_MANAGER only | Shell; completely separate from `/dashboard` |
| `SuperAdminOrgs` | `/superadmin/organizations` | SYSTEM_MANAGER | Org list: name, plan, user count, website count, status |
| `SuperAdminOrgDetail` | `/superadmin/organizations/:id` | SYSTEM_MANAGER | Deep org view + impersonate button |
| `SuperAdminStats` | `/superadmin/stats` | SYSTEM_MANAGER | Platform-wide metrics |
| `OrgSettings` | `/dashboard/settings/organization` | OWNER only | Edit org name, view plan |

> **V2 Note — Google OAuth on Signup:** Add a "Continue with Google" button to `SignupPage` and `LoginPage`. Backend: add `google_id` column to `User`, implement OAuth2 callback endpoint using Google's identity API. This is intentionally deferred from V1 to keep the auth surface minimal and auditable.

#### Store changes (`appStore.ts`)

```typescript
// Add to Zustand:
organization: {
  id: number;
  name: string;
  slug: string;
  plan: string;
  owner_id: number;
} | null

setOrganization(org: Organization | null): void

// User type gains:
organization_id: number | null;
role: 'system_manager' | 'owner' | 'manager' | 'agent';
```

On `GET /auth/me` response, also call `GET /organization` (for non-super-admins) to populate org state.

#### Role helpers (`lib/roles.ts`)

```typescript
// New:
export const isOrgOwner = (user) => user?.role === 'owner';
export const isSuperAdmin = (user) => user?.role === 'system_manager';

// Updated — now includes 'owner':
export const isAdmin = (user) =>
  ['system_manager', 'owner', 'manager'].includes(user?.role);
```

#### Routing changes

Super-admin gets an entirely separate route tree that `OWNER/MANAGER/AGENT` cannot access:

```tsx
<Route path="/signup" element={<SignupPage />} />

{/* Super-admin portal — completely separate from /dashboard */}
<Route
  path="/superadmin/*"
  element={isSuperAdmin(user) ? <SuperAdminLayout /> : <Navigate to="/login" replace />}
>
  <Route path="organizations" element={<SuperAdminOrgs />} />
  <Route path="organizations/:id" element={<SuperAdminOrgDetail />} />
  <Route path="stats" element={<SuperAdminStats />} />
</Route>

{/* Regular dashboard — SYSTEM_MANAGER should not land here */}
<Route
  path="/dashboard/*"
  element={token && !isSuperAdmin(user) ? <DashboardLayout /> : <Navigate to={isSuperAdmin(user) ? "/superadmin/organizations" : "/login"} />}
>
  {/* ...existing routes... */}
  {/* New: Org settings for OWNER */}
  <Route
    path="settings/organization"
    element={isOrgOwner(user) ? <OrgSettings /> : <Navigate to="/dashboard/chats" replace />}
  />
</Route>
```

#### Login redirect logic

After login, check role:
- `SYSTEM_MANAGER` → redirect to `/superadmin/organizations`
- Everyone else → redirect to `/dashboard/chats`

### B9a. Onboarding Wizard (New)

After signup (and optionally after any login with no prior dismissal), show an **Onboarding Wizard popup** to guide new org owners through initial setup. Requirement from user: 

- Modal/drawer popup appears automatically after the first login post-signup (localStorage flag `onboarding_dismissed_{org_id}`)
- Steps: 1. Create first website → 2. Install widget snippet → 3. Invite first team member → 4. Done
- Each step is individually completable and skippable
- "Skip all" / "I'll do this later" dismisses entirely
- A persistent icon in the **left sidebar above the user profile avatar** (e.g., a rocket/checklist icon) reopens the wizard at any time even after dismissal
- Wizard tracks completion state per-step in localStorage (or a backend `onboarding_completed_steps` field in `Organization.settings` JSON, V2)

Implementation location:
- `frontend/src/components/OnboardingWizard.tsx` — the modal component
- `frontend/src/pages/DashboardLayout.tsx` — render the sidebar icon + mount the wizard
- No backend changes required for V1 (use localStorage for state)

### B10. Widget — No Changes

The widget uses `widget_key` → `Website` → `organization_id`. The org boundary is enforced automatically on the backend. The embed snippet format and `chat-widget.js` do not change.

### B11. Security Checklist

| Concern | Implementation |
|---------|---------------|
| Cross-org data leakage | `organization_id` filter on every DB query via `get_org_scope()` |
| JWT org claim spoofing | Sensitive mutations re-verify org membership from DB |
| Super-admin access logging | All `/admin/*` calls logged with timestamp, user_id, target org |
| Signup spam | Rate-limit `POST /auth/signup` (e.g., 5/hour per IP) |
| Org deactivation | `is_active=False` on org → `get_current_user` rejects all org member tokens with 403 |
| Impersonation audit | `POST /admin/organizations/{id}/token` issues 60s token; always server-logged |
| SYSTEM_MANAGER isolation | `/superadmin/*` endpoints gated by `require_administrator`; no access to org data lanes |
| Widget domain validation | `enforce_widget_domain_or_403()` unchanged |

---

## Part C: Conversation / Session Refactor

### C1. The Problem (Corrected Understanding)

Currently `session_id` (a UUID generated once and stored in localStorage) is the visitor's permanent identity for a given website. The backend and widget both assume a single session maps to exactly one conversation — forever. This breaks the natural conversation lifecycle:

- A visitor who chatted last week and returns today continues inside that same old thread, which is wrong
- Once a conversation is resolved, there is no clean mechanism to start a fresh one under the same visitor identity
- Ratings fire on `conversation_closed` event regardless of whether a rating was already submitted — re-opening a resolved conversation re-triggers the rating popup
- The widget has no history view; visitors cannot revisit past exchanges

The fix is **not** about running multiple conversations simultaneously. There is always **at most one OPEN conversation per session at any point in time**. The change is about supporting multiple conversations over time, each with their own full lifecycle.

### C2. The Correct Lifecycle (Full Loop)

```
New visitor lands on website
  │
  ▼
session_id generated → stored in localStorage (survives page navigations, refreshes)
  │
  ▼
Widget displays. visit_count += 1 on every new page load (existing behaviour).
  │
  ▼
Bot sends welcome message → Conversation row created (status = OPEN)
  │
  ▼
Chat happens. Same conversation continues across all page navigations within
the same domain — because session_id is the same in localStorage.
  │
  ▼
Conversation CLOSES via one of three triggers:
  ┌──────────────────────────────────────────────────────┐
  │ A. Agent resolves it from the dashboard              │
  │ B. Visitor clicks the X button in the widget         │
  │    → rating prompt shown → then closed               │
  │ C. Visitor leaves site and does not return           │
  │    for 24 hours → auto-resolved by backend job       │
  └──────────────────────────────────────────────────────┘
  │
  ▼
status = RESOLVED. Rating recorded (if provided).
  │
  ▼
Visitor returns (localStorage intact, same session_id).
No OPEN conversation exists for this session.
  │
  ├─ History enabled → widget shows LIST VIEW of past conversations
  │    + "New Conversation" button at top
  │
  └─ History disabled → widget shows start screen ("Send us a message")
       first message → new Conversation row created under same session_id
  │
  ▼
New conversation begins. Loop repeats.
```

**Rules that must always hold:**
1. One `session_id` → many `Conversation` rows over time (1:N), each independently resolved
2. At any moment: at most **one OPEN** conversation per `(website_id, session_id)` pair — never concurrent
3. Same domain, new tab/page = same `session_id` = same active conversation continues
4. Incognito window = new `session_id` = treated as a new visitor entirely
5. "New Conversation" is only available when there is NO current OPEN conversation

### C3. Data Model Changes

The `Conversation` model already has `session_id`, `id`, `status`, `last_visitor_message_at`, and `last_agent_message_at`. No structural changes needed to the conversation model.

**Two additions required:**

#### 1. `show_conversation_history` on `Website` (dedicated column, not JSON)

```sql
ALTER TABLE websites ADD COLUMN show_conversation_history BOOLEAN NOT NULL DEFAULT FALSE;
```

This is a routing-logic flag, not a display preference — it must be a real column, not buried in `widget_config` JSON. Queried on every widget load.

#### 2. `closed_by` on `Conversation` (reason for close)

```sql
ALTER TABLE conversations ADD COLUMN closed_by VARCHAR(20) NULL;
-- Values: 'agent' | 'visitor' | 'inactivity'
```

Why: needed for analytics ("how many visitors abandoned vs agent-resolved"), and for audit when debugging rating logic. Also useful for auto-close detection (skip rating prompt for `inactivity`-closed conversations — the visitor is gone, no point).

#### 3. Auto-close background job (new)

A scheduled task (APScheduler or a cron-triggered endpoint) runs periodically (e.g., every hour) and resolves any OPEN conversation where:

```python
last_activity = max(last_visitor_message_at, last_agent_message_at, created_at)
age_hours = (now() - last_activity).total_seconds() / 3600
if age_hours >= 24:
    conversation.status = RESOLVED
    conversation.closed_by = 'inactivity'
    # No rating prompt triggered for inactivity closes
```

The `last_visitor_message_at` and `last_agent_message_at` fields already exist on `Conversation`. No model change needed, only the scheduler.

### C4. Widget Behavior

#### With history DISABLED (website setting off)

```
Widget opens
  ├─ OPEN conversation exists for this session?
  │    YES → enter that conversation thread directly
  │    NO  → show start screen ("Send us a message / New Conversation")
  │           first message → new Conversation created → enter thread
  │
  └─ In-thread: X button → rating prompt → conversation closed (closed_by='visitor')
```

No list view. No history. Identical to what a basic support chat does.

#### With history ENABLED (website setting on)

```
Widget opens
  ├─ OPEN conversation exists for this session?
  │    YES → enter that active thread directly (skip list; there's active chat to continue)
  │    NO  →
  │         ├─ Past (RESOLVED) conversations exist?
  │         │    YES → show LIST VIEW
  │         │           top: "New Conversation" card
  │         │           below: resolved conversations (most recent first)
  │         │    NO  → show start screen (first-time visitor, no history yet)
  │
  └─ In LIST VIEW:
       ├─ tap a resolved conversation → read-only thread view (can see messages, no reply box)
       ├─ tap "New Conversation" → new Conversation row created → enter active thread
       └─ back button (from thread) → return to list
```

**Rating unrated past conversations from list view (V2):** a small unrated badge on resolved conversations in the list. Visitor can rate inline without re-entering the thread.

### C5. Widget State Machine

```
BUBBLE (closed)
  └─ click bubble
       │
       ├─ has OPEN conversation?
       │    YES → THREAD VIEW (active)
       │
       └─ NO
            ├─ history disabled (or no past conversations)
            │    → START SCREEN ("Send us a message")
            │         first message → THREAD VIEW (new conversation)
            │
            └─ history enabled + past conversations exist
                 → LIST VIEW
                      ├─ tap resolved conv → THREAD VIEW (read-only)
                      ├─ tap "New Conversation" → THREAD VIEW (new active conv)
                      └─ back ← LIST VIEW

THREAD VIEW (active)
  └─ click X → RATING PROMPT → CLOSED (closed_by='visitor')
                    ↓
               back to LIST VIEW (if history enabled) or START SCREEN

THREAD VIEW (read-only / resolved)
  └─ back → LIST VIEW
```

### C6. Backend Changes

#### New endpoint: get conversation list for session

```
GET /widget/conversations
Query: ?website_id=X&session_id=Y&limit=20&offset=0
Returns: {
  active: { id, status, last_message_preview, last_message_at, assigned_agent_name, assigned_agent_avatar, unread_count } | null,
  history: [
    { id, status, last_message_preview, last_message_at, assigned_agent_name, assigned_agent_avatar, is_rated, created_at }
  ],
  total: int
}
```

Separating `active` from `history` in the response avoids the widget having to filter the list to find the open conversation.

#### Existing bug: `get_or_create_conversation` does not filter by status

`ConversationService.get_or_create_conversation()` currently queries:

```python
# CURRENT (buggy) — returns ANY conversation for this session, even RESOLVED ones
conversation = db.query(Conversation).filter_by(session_id=session_id, website_id=website_id).first()
```

This means a returning visitor always gets routed to their very first (possibly long-resolved) conversation. This must be fixed to:

```python
# FIXED — only resume an OPEN conversation
conversation = db.query(Conversation).filter_by(
    session_id=session_id, website_id=website_id, status=ConversationStatus.OPEN
).first()
```

This single-line fix is the core of the session/conversation refactor on the backend. Without it, the lifecycle loop cannot work.

#### Updated: conversation auto-creation on first message

The backend must check before creating a new conversation:

```python
# On first message from visitor:
existing_open = db.query(Conversation).filter(
    Conversation.website_id == website_id,
    Conversation.session_id == session_id,
    Conversation.status == ConversationStatus.OPEN
).first()

if existing_open:
    # Route message to existing conversation
    target_conversation = existing_open
else:
    # Safe to create new
    target_conversation = Conversation(website_id=..., session_id=..., status=OPEN)
```

This guard must also exist in `POST /widget/conversations/new` (explicit new conversation):

```
POST /widget/conversations/new
Body: { website_id, session_id }
Returns: { conversation_id } on 201
Returns: 409 if an OPEN conversation already exists for this session
```

The 409 response prevents duplicate-tap race conditions and serves as the API contract: you can only have one OPEN conversation at a time.

#### WebSocket URL change

Current: `/ws/chat/{website_id}/{session_id}`

Problem: with multiple conversations per session, the backend does not know which conversation to route messages to when there are historical ones.

New: `/ws/chat/{website_id}/{session_id}/{conversation_id}`

- Widget always passes `conversation_id` when entering a thread
- Backend routes messages directly to the specified conversation
- For new conversations (visitor sends first message without a conversation_id): keep the old auto-create path as fallback, assign the resulting conversation_id, send it back to the widget via WebSocket message `{type: "conversation_created", conversation_id: X}`

#### Rating endpoint (new)

```
GET /widget/conversations/{conversation_id}/rating
Returns: { rating: 1|0|-1, feedback: str } | { rating: null }
```

Used by widget before showing rating prompt to check if already rated.

#### Auto-close background job endpoint (internal)

```
POST /internal/jobs/auto-close-conversations
```

Called by APScheduler every hour. Not exposed publicly. Resolves all OPEN conversations with no activity for ≥ 24 hours. Sets `closed_by = 'inactivity'`.

### C7. Conversation Rating Fixes

#### Fix 1: Skip rating prompt for inactivity-closed conversations

The rating popup fires on the `conversation_closed` WebSocket event (pushed to widget). When `closed_by = 'inactivity'`, the visitor is not present — no event reaches them. The popup only appears in the widget for `closed_by = 'agent'` or `closed_by = 'visitor'`.

For `closed_by = 'agent'`: the conversation_closed event is pushed to the visitor's WebSocket. Widget receives it → shows rating prompt.  
For `closed_by = 'visitor'`: widget initiated the close → shows rating prompt inline before the WebSocket close.  
For `closed_by = 'inactivity'`: visitor is offline. No live WebSocket exists. No popup. If visitor returns later, they see the conversation in RESOLVED state in the history list. A "rate this conversation" prompt can appear in the list badge (V2).

#### Fix 2: Guard against re-showing rating popup

If `conversation_closed` event fires in two tabs (network hiccup, duplicate emit):

```js
// Widget: before showing rating popup
const alreadyRated = localStorage.getItem(`rated_${conversationId}`);
if (alreadyRated) return; // skip
// Show popup
// On submit:
localStorage.setItem(`rated_${conversationId}`, '1');
```

#### Fix 3: Guard against re-showing popup after conversation is re-opened in widget

When visitor opens a resolved conversation from the history list (read-only view), no rating prompt should appear — it's a historical view. Rating prompt only appears immediately after a conversation closes while the visitor is active.

### C8. Agent Dashboard Changes

The conversations list in the dashboard will naturally show one row per conversation. A visitor who has chatted three times over three days appears three times in the list — this is correct. No dashboard list change needed.

What needs to be added:

- **Visitor's conversation history** in the right detail panel: when an agent views a conversation, show a "Other conversations from this visitor" section pulled by `session_id`. Click any past conversation to navigate to it.
- **`closed_by` display**: show a small label in the conversation detail view indicating how the conversation was closed (agent / visitor / inactivity).
- **Visit count badge**: already stored (`visit_count` on `Conversation`). Display it in the header of the conversation detail panel ("Visited 7 times").

### C9. Edge Cases and Decisions Already Made

| Topic | Decision |
|-------|----------|
| **Simultaneous conversations** | Never. At most one OPEN conversation per `(website_id, session_id)`. `POST /widget/conversations/new` returns 409 if one already exists. This rule is also what makes push notifications correct: when an agent receives a push for a new visitor message, there is exactly one OPEN conversation the notification can belong to. If multiple could be OPEN, the agent would receive ambiguous notifications with no way to know which thread to open. The push payload must include `conversation_id` for deep-linking — the current implementation does not include it (existing bug to fix). |
| **New page = new conversation?** | No. Same domain + same localStorage = same session_id = same OPEN conversation continues. Only when the current conversation is RESOLVED does a new page load start fresh. |
| **Returning visitor (same localStorage)** | If OPEN conv exists → resume. If no OPEN conv → new conversation (history disabled) or list view (history enabled). |
| **Incognito / cleared localStorage** | New session_id → treated as brand new visitor. No way to link without email contact unification (V2 feature). |
| **Auto-close threshold** | 24 hours of inactivity. Configurable per-org in V2 (stored in `Organization.settings` JSON). |
| **Rating after inactivity close** | Not triggered immediately (visitor offline). Can appear as unrated badge in history list (V2). |
| **Automation `visitor_joins` trigger** | Now fires per new conversation creation (not per session start). If website is on its 5th conversation with this session_id, automations still fire for the new conversation. This is correct — each conversation is independent. |
| **`visit_count` tracking** | Increments on every page load regardless of conversation state. Not tied to conversation lifecycle. |
| **Conversation title/preview** | Auto-generated from the visitor's first message (truncated to 60 chars). Shown in list view. No AI needed. |
| **Pagination in widget list** | `GET /widget/conversations` accepts `limit` and `offset`. Widget shows 20 per page with a "Load more" button. |
| **Push notifications** | Must include `conversation_id` in payload so agent can deep-link to the right thread. |
| **Rating popup: two browser tabs** | Both tabs receive `conversation_closed` event. localStorage flag `rated_{conversation_id}` prevents double-popup. |
| **Draft message preservation** | Store draft in localStorage keyed by `conversation_id` (not session_id). Switching conversations preserves each draft independently. |

---

## Part F: Email Service

### F1. Decision: Resend

Resend (`resend.com`) is the right choice for now:
- Clean Python SDK — sending an email is two lines of code
- Free tier: 3,000 emails/month, 100/day — more than enough through early growth
- Good deliverability out of the box (no SPF/DKIM configuration complexity for the sender)
- When it becomes expensive: swap to AWS SES ($0.10 per 1,000 emails) or self-hosted (Postal). The swap costs zero refactoring effort because all email calls go through a single `EmailService` class — only that class changes

This is a pragmatic pick. Resend's free tier covers you through the first few hundred organisations. Agree with the choice.

### F2. V1 Emails (Required Before Launch)

| Email | Trigger | Priority |
|-------|---------|----------|
| **Password reset** | User clicks "Forgot password?" on login screen | **Required** — without this, locked-out users have no self-service recovery |
| **Welcome to org** | New org created via signup | Optional — nice to have, not a blocker |

### F3. V2 Emails (After Launch)

| Email | Trigger |
|-------|--------|
| User invite | Org owner invites a team member by email (V2 invite flow) |
| Org deactivated | Super-admin deactivates an org — notify the owner |
| Inactivity digest | Weekly summary for agents (V3 nicety) |

### F4. When to Integrate

Email infrastructure goes in **Phase 1** (model: `PasswordResetToken`) and **Phase 2** (endpoints + frontend pages). It must be done before any real users are onboarded. The current manual workaround (`PATCH /{user_id}/password` by admin) only works when an admin is available — it fails completely if the admin themselves is locked out.

### F5. Password Reset Security Design

This must be done correctly. The attack surface on a password reset endpoint is well-known.

**Token generation and storage:**
```python
import secrets
import hashlib

raw_token = secrets.token_urlsafe(32)        # 43-char URL-safe string sent in email
token_hash = hashlib.sha256(raw_token.encode()).hexdigest()  # stored in DB
# Never store the raw token. If the DB is leaked, tokens are useless.
```

**New model: `PasswordResetToken`**
```python
class PasswordResetToken(Base):
    __tablename__ = "password_reset_tokens"

    id         = Column(Integer, primary_key=True)
    user_id    = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    token_hash = Column(String(64), unique=True, nullable=False)  # SHA-256 hex
    expires_at = Column(DateTime(timezone=True), nullable=False)  # issued + 1 hour
    used_at    = Column(DateTime(timezone=True), nullable=True)   # None = still valid

    user = relationship("User")
```

**Security rules:**
- Expiry: 1 hour from issue
- Single-use: set `used_at` immediately on successful reset; further uses are rejected
- Always return HTTP 200 on `POST /auth/forgot-password` regardless of whether the email exists — prevents email enumeration attacks
- Rate-limit `POST /auth/forgot-password`: 5 requests/hour per IP and per email address
- On password reset success, invalidate all existing sessions for that user (update `SystemSettings.last_reset_at` is platform-wide — instead, add `password_changed_at` to `User` and check it in `get_current_user`)

### F6. New Endpoints

```
POST /auth/forgot-password
Body: { "email": "alice@acme.com" }
Response: 200 always (even if email not found)
Action: if email exists → generate token → send reset email

POST /auth/reset-password
Body: { "token": "<raw token from email>", "new_password": "..." }
Response: 200 on success, 400 if token invalid/expired/used
Action: hash token → look up → validate → update password → mark token used
```

### F7. Service Abstraction

`backend/app/services/email_service.py`:

```python
class EmailService:
    """Single abstraction layer for all outgoing email.
    Swap the provider by changing only this file."""

    def send_password_reset(self, to_email: str, name: str, reset_url: str) -> bool: ...
    def send_welcome(self, to_email: str, name: str, org_name: str) -> bool: ...
```

**ENV vars required:**
```
RESEND_API_KEY=re_xxxxxxxxxxxx
FROM_EMAIL=AI ChatAssist <noreply@yourdomain.com>
FRONTEND_URL=https://app.yourdomain.com   # for building reset links
```

The reset link sent in email: `{FRONTEND_URL}/reset-password?token={raw_token}`

### F8. Frontend Pages

| Page | Route | Purpose |
|------|-------|---------|
| Link on `LoginPage` | — | "Forgot password?" → navigates to `/forgot-password` |
| `ForgotPasswordPage` | `/forgot-password` | Email input form; submits to `POST /auth/forgot-password`; shows generic success message regardless of result |
| `ResetPasswordPage` | `/reset-password?token=X` | New password + confirm; submits to `POST /auth/reset-password`; redirects to `/login` on success |

Both new pages are public (no auth required). No dashboard wrapper.

---

## Part D: What Needs to Be Added / Removed

### Things to REMOVE

| Item | Location | Reason |
|------|----------|--------|
| `ResetApplication.tsx` | `frontend/src/pages/ResetApplication.tsx` | Reset via CLI only |
| `/dashboard/reset` route | `frontend/src/App.tsx` | Same |
| `import ResetApplication` | `frontend/src/App.tsx` | Orphaned after page deletion |
| `POST /system/reset` endpoint | `backend/app/api/system.py` | Functionality moved to CLI script |
| `system` router registration | `backend/app/main.py` | After endpoint removal |
| Old bootstrap redirect for `SYSTEM_MANAGER` to `/dashboard` | `frontend/src/App.tsx` | Super-admin must go to `/superadmin` |

### Things to ADD (Multi-Tenant)

| Item | Type | Phase |
|------|------|-------|
| `Organization` model | Backend model | 1 |
| `organization_id` on `User` + `Website` | DB column + Alembic migration | 1 |
| `OWNER` role in `UserRole` enum | Backend enum | 1 |
| `organization_id` in JWT payload | Auth | 1 |
| `POST /auth/signup` | API endpoint | 2 |
| Updated `POST /auth/register` (auto-inherit org) | API endpoint | 2 |
| New dep functions (`require_org_admin`, `require_org_owner`, `get_org_scope`) | Backend deps | 2 |
| Updated `compute_visibility_scope()` | Backend service | 2 |
| Org-scoped filters on all existing endpoints | API endpoints | 3 |
| `GET/PATCH/DELETE /organization` | API endpoints | 3 |
| `/admin/*` super-admin endpoints | API endpoints | 3 |
| `SignupPage` | Frontend page | 4 |
| `SuperAdminLayout` + sub-pages | Frontend pages | 4 |
| `OrgSettings` page | Frontend page | 4 |
| `organization` in `appStore` | Frontend store | 4 |
| Updated role helpers + routing guards | Frontend | 4 |
| Login redirect by role | Frontend | 4 |

### Things to ADD (Email Service)

| Item | Type | Phase |
|------|------|-------|
| `PasswordResetToken` model | Backend model | 1 |
| `password_changed_at` column on `User` | DB column | 1 |
| `RESEND_API_KEY`, `FROM_EMAIL`, `FRONTEND_URL` env vars | Config | 1 |
| `EmailService` class (Resend wrapper) | Backend service | 1 |
| `POST /auth/forgot-password` | API endpoint | 2 |
| `POST /auth/reset-password` | API endpoint | 2 |
| "Forgot password?" link on `LoginPage` | Frontend | 2 |
| `ForgotPasswordPage` at `/forgot-password` | Frontend page | 2 |
| `ResetPasswordPage` at `/reset-password` | Frontend page | 2 |

### Things to ADD (Conversation Refactor)

| Item | Type | Phase |
|------|------|-------|
| `show_conversation_history` column on `Website` | DB column + Alembic migration | 1 |
| `closed_by` column on `Conversation` (`'agent'`,`'visitor'`,`'inactivity'`) | DB column + Alembic migration | 1 |
| Auto-close background job (APScheduler, resolves 24h inactive convs) | Backend service | 1 |
| `GET /widget/conversations` (list: active + history, paginated) | API endpoint | 2 |
| `POST /widget/conversations/new` (409 if OPEN already exists) | API endpoint | 2 |
| `GET /widget/conversations/{id}/rating` | API endpoint | 2 |
| Updated WebSocket URL: `/ws/chat/{website_id}/{session_id}/{conversation_id}` | Backend + Widget | 2 |
| `conversation_created` WebSocket event (for new-conv flow) | Backend + Widget | 2 |
| Widget: on-open check for OPEN vs RESOLVED state + routing | Widget JS | 3 |
| Widget list view screen (active thread header + resolved history list) | Widget JS/CSS | 3 |
| Widget: "New Conversation" card (only shown when NO OPEN conv exists) | Widget JS/CSS | 3 |
| Widget: back navigation (thread → list) | Widget JS/CSS | 3 |
| Widget: read-only thread view for resolved conversations | Widget JS/CSS | 3 |
| Rating popup `already-rated` localStorage guard | Widget JS | 3 |
| Rating prompt suppressed for `inactivity` closed conversations | Widget JS | 3 |
| Draft preservation per `conversation_id` in localStorage | Widget JS | 3 |
| Conversation title auto-generated from first visitor message (60 chars) | Backend (on message create) | 3 |
| `show_conversation_history` toggle in Website settings UI | Frontend (WebsiteDetail) | 4 |
| "Other conversations from this visitor" panel in agent dashboard | Frontend component | 4 |
| `closed_by` label in agent conversation detail view | Frontend component | 4 |

---

## Part E: Combined Implementation Phases

These phases assume the app is reset to a clean DB state before any coding begins.

### Phase 0 — Cleanup (Do First)
- [x] Delete `ResetApplication.tsx` and its route
- [x] Remove `POST /system/reset` API endpoint and router registration

### Phase 1 — Backend Data Model
- [x] Add `OWNER` to `UserRole` enum
- [x] Create `Organization` model
- [x] Add `organization_id` FK to `User` and `Website`
- [x] Add `show_conversation_history` column to `Website`
- [x] Add `closed_by` column to `Conversation` (`'agent'`,`'visitor'`,`'inactivity'`)
- [x] Add `password_changed_at` column to `User` (for session invalidation after password reset)
- [x] Create `PasswordResetToken` model
- [x] Write Alembic migration (all above in one migration since DB is being reset)
- [x] Update `create_access_token` to include `organization_id`
- [x] Update `get_current_user` to decode `organization_id` and check `password_changed_at` against token `iat`
- [x] Add APScheduler (or equivalent) for auto-close background job (24h inactivity → RESOLVED, closed_by='inactivity')
- [x] Add `EmailService` class wrapping Resend SDK
- [x] Add `RESEND_API_KEY`, `FROM_EMAIL`, `FRONTEND_URL` to settings/config
- [x] Add `is_email_verified` column to `User` (default `True` for existing users, `False` for new signups)
- [x] Create `EmailOTP` model (`user_id`, `otp_hash`, `expires_at`, `used_at`)
- [x] Add `RESEND_OVERRIDE_TO_EMAIL` env var to settings/config and `.env`
- [x] Add migration for the above (d11f4a7ff2bd, applied)

### Phase 2 — Auth, Onboarding & Email
- [x] **Fix `get_or_create_conversation`** to filter by `status=OPEN` (the core bug of the session refactor)
- [x] Add `POST /auth/signup` (atomic org + user creation)
- [x] Update `POST /auth/register` (auto-assign org from calling user)
- [x] Add `POST /auth/forgot-password` (rate-limited, always 200, sends reset email)
- [x] Add `POST /auth/reset-password` (validates token hash, updates password, invalidates token)
- [x] Add `ForgotPasswordPage` (`/forgot-password`) and `ResetPasswordPage` (`/reset-password`)
- [x] Add "Forgot password?" link to `LoginPage`
- [x] Add new dep functions (`require_org_admin`, `require_org_owner`, `get_org_scope`)
- [x] Update `compute_visibility_scope()` with org boundary layer
- [x] Add `GET /widget/conversations` (active + history list, paginated)
- [x] Add `POST /widget/conversations/new` (409 guard if OPEN conv exists)
- [x] Add `GET /widget/conversations/{id}/rating`
- [x] Update WebSocket path to `/ws/chat/{website_id}/{session_id}/{conversation_id}`
- [x] Add `conversation_created` WebSocket message type (for auto-create flow)
- [x] Fix push notification payload to include `conversation_id` for agent deep-linking (Gap F)
- [x] **Email OTP:** Update `POST /auth/signup` to not return JWT; return `{ needs_verification: true, email }` instead
- [x] **Email OTP:** Add `POST /auth/verify-otp` endpoint (hash OTP, validate, mark used, set `is_email_verified=True`, return JWT)
- [x] **Email OTP:** Add `EmailService.send_otp_verification()` method (routes to `RESEND_OVERRIDE_TO_EMAIL` when set)
- [x] **Email OTP:** Add `POST /auth/resend-otp` endpoint

### Phase 3 — API Scoping, Gap Fixes & Widget
- [x] Add `organization_id` filter to all existing endpoints (websites, users, chats, analytics, customers, tags, automations, teams)
- [x] Add `/organization` CRUD endpoints
- [x] Add `/admin/*` super-admin endpoints
- [x] **Gap E:** Fix OWNER/MANAGER `visible_website_ids` in `agent_service.py` — OWNER sees all org websites; MANAGER sees assigned websites
- [x] **Gap B:** Block MANAGER from promoting to OWNER in `PATCH /users/{id}/role`
- [x] **Gap C:** Block `role=system_manager` and `role=owner` from non-owner callers in `POST /auth/register` (was already guarded; confirmed)
- [x] **Gap D:** Fix AgentsList UI — remove `system_manager` from role dropdown; add `owner`
- [x] **Gap F:** Fix push URL — use `conversation_id` not `session_id`
- [x] **Gap A:** Add website assignment check for MANAGER on `PUT /websites/{id}`
- [ ] Widget: on-open routing (check OPEN conv → enter thread, else list/start screen)
- [ ] Widget: list view — active thread header + resolved conversation history
- [ ] Widget: "New Conversation" card (hidden when OPEN conv exists)
- [ ] Widget: back navigation (thread → list)
- [ ] Widget: read-only view for resolved conversations from history
- [ ] Widget: rating popup guards (localStorage flag, skip for inactivity-closed)
- [ ] Widget: draft preservation keyed by `conversation_id`
- [ ] Backend: auto-generate conversation title from first visitor message (truncate 60 chars)

### Phase 4 — Frontend
- [x] `SignupPage` + `/signup` route
- [x] Login redirect by role (super-admin → `/superadmin`, others → `/dashboard/chats`)
- [x] `SuperAdminLayout` + `SuperAdminOrgs` + `SuperAdminOrgDetail` + `SuperAdminStats`
- [x] `OrgSettings` page
- [x] `organization` state in `appStore`
- [x] Update role helpers and all routing guards
- [x] **Email OTP:** Add OTP entry step to `SignupPage` (inline step-2 after form submission)
- [ ] `show_conversation_history` toggle in WebsiteDetail settings tab
- [ ] "Other conversations from this visitor" section in agent conversation detail sidebar
- [ ] `closed_by` label in agent conversation detail view
- [ ] Onboarding wizard component + sidebar icon (see B9a)

### Phase 5 — Testing & Security Audit
- [ ] Cross-org isolation tests (agent from Org A cannot access Org B's data)
- [ ] Super-admin bypass tests
- [ ] Multi-conversation widget flow tests (new conversation, rating guard, unread aggregate)
- [ ] Signup → dashboard happy path
- [ ] JWT `organization_id` tampering test
- [ ] Org deactivation test (all org member logins rejected)
- [ ] Password reset: token expiry test, token reuse test, email enumeration test (always 200)
- [ ] Password reset: session invalidation test (old token rejected after password change)
- [ ] `get_or_create_conversation` regression test: resolved conversation → returning visitor → new conversation created (not resumed)

---

*This document is the source of truth. Update it as decisions change. Do not start coding until a section's design is confirmed.*
