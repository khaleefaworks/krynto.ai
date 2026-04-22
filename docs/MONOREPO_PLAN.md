# Monorepo Migration Plan

**Status:** Planned — not started. Work begins after the documentation milestone is complete.

---

## Current Structure (Multi-package, not a true monorepo)

```
ai-chatassist/
  backend/      ← Python/FastAPI (independent)
  frontend/     ← React/Vite (independent, name: "frontend")
  widget/       ← Vanilla JS (independent)
  docs/         ← planning documents
  deploy/       ← nginx, systemd, scripts
```

Each package is fully self-contained. There is one `.git` root, but no shared tooling, no workspace manager, and no shared packages. Code that should be shared (TypeScript types, API client functions, auth logic) is either duplicated or tightly coupled inside `frontend/src/`.

---

## Why Migrate to a Monorepo

When the mobile app is added, the following would be duplicated across `frontend/` and `mobile/` without a monorepo:

- TypeScript types for Conversation, Message, User, Organization (already defined in `frontend/src/`)
- API service functions (`services/chats.ts`, `services/auth.ts`, etc.)
- Zod schemas / validation logic
- Role helpers (`lib/roles.ts`)
- Constants and config (`config/endpoints.ts`)

A monorepo with `pnpm workspaces` solves this by extracting shared code into a `packages/shared` package that both `apps/dashboard` and `apps/mobile` import.

---

## Target Structure

```
ai-chatassist/
  apps/
    dashboard/        ← current frontend/ (renamed)
    mobile/           ← new React Native / Expo app
  packages/
    shared/           ← shared TS types, API client, zod schemas, role helpers
  backend/            ← unchanged
  widget/             ← unchanged (no TS, no workspace needed)
  docs/
  deploy/
  package.json        ← root workspace config (pnpm)
  pnpm-workspace.yaml
```

---

## Tooling Choice: pnpm workspaces (no Turborepo yet)

**pnpm workspaces** is sufficient at this stage. Turborepo adds build caching and pipeline orchestration but is overkill until there are 3+ JS packages with interdependencies.

Upgrade to Turborepo later if:
- Build times become a problem (>2 min per package)
- More than 3 interdependent JS packages exist
- CI parallelism becomes a bottleneck

---

## What Goes Into `packages/shared`

| Module | Source file today | Consumers |
|--------|------------------|-----------|
| TypeScript types | `frontend/src/types/` (implicit, inline) | dashboard, mobile |
| API base client | `frontend/src/services/api.ts` | dashboard, mobile |
| Auth service | `frontend/src/services/auth.ts` | dashboard, mobile |
| Chats service | `frontend/src/services/chats.ts` | dashboard, mobile |
| Messages service | `frontend/src/services/messages.ts` | dashboard, mobile |
| Role helpers | `frontend/src/lib/roles.ts` | dashboard, mobile |
| Zod schemas | inline in components | dashboard, mobile |
| Constants | `frontend/src/config/endpoints.ts` | dashboard, mobile |

UI components, Zustand stores, and React-specific hooks stay in each app. Only logic and types that are truly platform-agnostic move to `packages/shared`.

---

## Migration Steps (one-time, ~2–4 hours)

### Step 1 — Add root package.json + pnpm-workspace.yaml

```json
// package.json (root)
{
  "name": "ai-chatassist",
  "private": true,
  "packageManager": "pnpm@9.x"
}
```

```yaml
# pnpm-workspace.yaml
packages:
  - 'apps/*'
  - 'packages/*'
```

### Step 2 — Rename frontend/ → apps/dashboard/

```bash
mkdir -p apps
mv frontend apps/dashboard
```

Update `apps/dashboard/package.json`: change `"name": "frontend"` → `"name": "@ai-chatassist/dashboard"`.

Update any deploy scripts, systemd service files, or CI that reference `frontend/`.

### Step 3 — Create packages/shared

```bash
mkdir -p packages/shared/src
```

```json
// packages/shared/package.json
{
  "name": "@ai-chatassist/shared",
  "version": "0.0.1",
  "private": true,
  "main": "./src/index.ts",
  "types": "./src/index.ts"
}
```

Move shared types and service functions from `apps/dashboard/src/` into `packages/shared/src/`, then re-import them in dashboard:

```ts
import { Conversation, Message } from '@ai-chatassist/shared'
```

### Step 4 — Create apps/mobile/ (React Native + Expo)

```bash
cd apps
npx create-expo-app mobile --template blank-typescript
```

Install shared package:

```json
// apps/mobile/package.json
{
  "dependencies": {
    "@ai-chatassist/shared": "workspace:*"
  }
}
```

The mobile app uses `@ai-chatassist/shared` for API calls and types. UI is built with React Native components (not Tailwind — use NativeWind or StyleSheet).

### Step 5 — Update CI

GitHub Actions workflow needs to install from the workspace root:

```yaml
- run: pnpm install  # installs all workspaces
- run: pnpm --filter @ai-chatassist/dashboard build
- run: pnpm --filter @ai-chatassist/mobile build
```

---

## Backend and Widget — No Changes

- `backend/` is Python. It does not participate in the JS workspace. No changes needed.
- `widget/` is vanilla JS with no npm dependencies. It stays at root level. No changes needed.

---

## Deploy Impact

| Service | Change needed |
|---------|--------------|
| Nginx (dashboard) | Update build output path: `apps/dashboard/dist/` instead of `frontend/dist/` |
| Systemd (backend) | None |
| CI build step | Update `working-directory` from `frontend` → `apps/dashboard` |
| QUICK_START.md | Update `cd frontend` instructions → `cd apps/dashboard` |

---

## When to Do This

After the documentation milestone is complete and the major feature backlog is cleared. The migration itself does not change any runtime behavior — it is a pure reorganization. The mobile app can be stubbed out in `apps/mobile/` before the full migration is done if needed, but migrating before starting mobile development is the cleaner path.
