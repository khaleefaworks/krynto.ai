# Next Features & Bug Fixes (Task Sheet)

Single source of truth for the current post-refactor work. Keep this file updated as tasks move.

Legend: **Done** = shipped, **In Progress** = active work, **Todo** = not started.

## Tasks

### Availability / Chat Flow

- [x] **Done** — Agent availability auto-enables when agent actively handles a chat
	- Behavior: when an agent joins/takes over/sends their first message, backend flips `is_available=true` (best-effort) and UI reflects instantly.
	- Notes: availability does **not** block join/send; it self-corrects to avoid confusing states.

### Chat Page UX

- [x] **Done** — Chat page panels default collapsed
	- Acceptance: fresh browser profile loads with left filter + right meta panel collapsed; stored localStorage values still win.

- [x] **Done** — Conversation list time reflects last message time
	- Acceptance: new agent/visitor messages update list preview timestamp.

### Dashboard / Settings

- [ ] **Todo** — Desktop sidebar: move Settings icon to bottom
	- Desktop only: settings icon between theme toggle and profile.
	- Mobile unchanged.

- [x] **Done** — Settings URL + naming uses **Users** everywhere
	- Refactor: `/dashboard/settings/agents` → `/dashboard/settings/users`.
	- Backwards-compatible redirect kept for old URLs.

- [x] **Done** — Settings → Users table shows profile icon (avatar) when set
	- If avatar exists: show image; else show initials.

- [x] **Done** — Settings → Users table has **Status** toggle (enable/disable)
	- Status maps to `is_active` (admin-controlled).
	- **Administrator (system_manager) is always enabled** (toggle disabled).

- [x] **Done** — Email can be edited for existing users
	- Applies to Administrator too.

- [x] **Done** — Username can only be set once
	- Name is editable only if currently empty; otherwise read-only.

### Data / Backend

- [x] **Done** — Store each visitor IPv4 in the DB
	- Stored as `conversations.visitor_ip` (string). No UI yet.
