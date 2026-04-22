# Frontend — AI ChatAssist

React 19 + TypeScript agent dashboard. Handles conversations, settings, customers, analytics, and the public docs portal.

## Stack

- **React 19**, TypeScript, Vite 7
- **Tailwind CSS v3** + `@tailwindcss/typography`
- **Zustand v5** — global state
- **react-router-dom v7** — client-side routing
- **Tiptap v3** — rich text message composer
- **react-hook-form + zod** — form validation
- **react-markdown + remark-gfm** — markdown rendering (docs portal + chat)
- **Recharts** — analytics charts
- **Radix UI** — headless accessible primitives
- **Lucide React** — icons

## Directory structure

```
frontend/src/
├── App.tsx               # Route definitions, auth init, global WS setup
├── main.tsx              # React entry point
├── index.css             # Tailwind imports + CSS variables (light/dark)
├── assets/               # Static assets
├── components/           # Shared UI components
│   ├── Logo.tsx
│   ├── ChatComposer.tsx
│   ├── MarkdownMessage.tsx
│   ├── UserAvatar.tsx
│   ├── NotificationPermissionPrompt.tsx
│   └── ui/               # Headless primitives (button, badge, popover, etc.)
├── config/
│   ├── endpoints.ts      # API_BASE — derived from VITE_API_BASE or hostname
│   └── docsNav.ts        # Docs portal nav config (sections → pages → slugs)
├── lib/
│   ├── roles.ts          # Role helpers: isAdmin(), isSuperAdmin(), isOrgOwner()
│   ├── notificationSound.ts  # Sound playback + preferences
│   └── utils.ts          # cn() class merger
├── pages/                # Route-level components (one file per page/layout)
│   ├── DashboardLayout.tsx       # Main shell: sidebar, availability toggle
│   ├── ConversationsView.tsx     # Agent inbox (3-column)
│   ├── ConversationHistory.tsx   # Chat thread + visitor details panel
│   ├── ClosedChatView.tsx        # Read-only resolved conversation
│   ├── WebsitesList.tsx / WebsiteDetail.tsx / WebsiteManagement.tsx
│   ├── WebsiteWidgetTab.tsx      # Widget customisation + live preview
│   ├── WebsiteTeamsTab.tsx / WebsiteTagsTab.tsx / WebsiteShortcutsTab.tsx
│   ├── AgentsList.tsx / AgentsManagement.tsx
│   ├── Teams.tsx
│   ├── Customers.tsx / CustomersVisitors.tsx / CustomersContacts.tsx
│   ├── Analytics.tsx
│   ├── Settings.tsx              # Settings shell
│   ├── OrgSettings.tsx
│   ├── PersonalSettings.tsx
│   ├── PersonalShortcutsSettings.tsx
│   ├── NotificationSettings.tsx
│   ├── TagsSettings.tsx
│   ├── SuperAdminLayout.tsx / SuperAdminOrgs.tsx / SuperAdminOrgDetail.tsx / SuperAdminStats.tsx
│   ├── DocsLayout.tsx            # Public /docs layout (no auth)
│   ├── DocsPage.tsx              # Markdown page renderer
│   ├── LoginPage.tsx / SignupPage.tsx / ForgotPasswordPage.tsx / ResetPasswordPage.tsx
│   └── OnboardingPage.tsx        # First-run setup wizard
├── services/             # HTTP API clients + WebSocket
│   ├── api.ts            # Base fetch wrapper (auth header, error handling)
│   ├── auth.ts           # Login, logout, getCurrentUser, availability toggle
│   ├── chats.ts          # fetchActiveChats, joinChat, resolveChat, markRead
│   ├── messages.ts       # fetchMessages
│   ├── agentSocket.ts    # Agent WS singleton — connect, send, addMessageHandler
│   ├── websites.ts       # CRUD websites
│   ├── automations.ts
│   ├── teams.ts
│   ├── customers.ts
│   ├── push.ts           # Web Push subscription
│   ├── notificationPrefs.ts
│   ├── conversationMetadata.ts
│   └── shortcuts.ts
└── store/
    ├── appStore.ts       # Auth, chats, unread counts, WS state, notifications
    └── messages.ts       # Per-conversation message cache
```

## Key state (Zustand — appStore)

| Slice | Description |
|-------|-------------|
| `token` / `user` | Auth state — persisted in localStorage |
| `organization` | Current org data |
| `activeChats` | Live conversation list |
| `unreadChatsCount` | Global unread badge (sidebar) |
| `unreadByConversationId` | Per-conversation unread count |
| `currentChat` / `messages` | Active thread data |
| `isConnected` | Agent WS connection state |

## Routing

All routes defined in `App.tsx`:

```
/login, /signup, /forgot-password, /reset-password   — public auth
/docs/*                                               — public docs portal (no auth)
/setup                                                — first-run onboarding
/dashboard/*                                          — protected, OWNER/MANAGER/AGENT
/superadmin/*                                         — protected, SYSTEM_MANAGER only
```

Dark mode is controlled by `"class"` strategy in `tailwind.config.js` — the `dark` class is toggled on `<html>` by the dashboard layout and docs layout independently, each persisting their preference in localStorage under separate keys.

## Environment variables

Create `frontend/.env.local`:

| Variable | Description |
|----------|-------------|
| `VITE_API_BASE` | Backend URL — e.g. `http://localhost:8000` or `https://api.example.com` |

If not set, the frontend auto-derives the API base from the current hostname (replaces port 5173 → 8000 in development).

## Development

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # Production build → dist/
npm run typecheck  # Type-check without emitting
npm run lint       # ESLint
```

## Docs portal

The `/docs` route is a public, no-auth page serving end-user documentation.

- Content: `frontend/public/docs-content/**/*.md` (served as static assets)
- Nav config: `frontend/src/config/docsNav.ts`
- Layout: `DocsLayout.tsx` — sticky header, responsive sidebar, dark mode toggle
- Renderer: `DocsPage.tsx` — fetches `.md` at runtime, renders with `react-markdown`

**Adding a new doc page:**
1. Create `frontend/public/docs-content/<section>/<slug>.md`
2. Add `{ title: '...', slug: '<section>/<slug>' }` to the relevant section in `docsNav.ts`

## agentSocket singleton

`src/services/agentSocket.ts` manages a single persistent WebSocket to `/ws/agent/0`:

- Auto-reconnects with exponential backoff (max 30 s)
- Sends `heartbeat` every 25 s to keep the connection alive
- Queues outgoing messages while disconnected and flushes on reconnect
- `addMessageHandler(fn)` — register a callback for all incoming events; returns an unsubscribe function

Usage:
```ts
import { connectAgentSocket, addMessageHandler, sendAgentMessage } from '@/services/agentSocket'

connectAgentSocket(0, user.id)
const unsubscribe = addMessageHandler((data) => { /* handle event */ })
sendAgentMessage(conversationId, 'Hello!')
```

## Role helpers (src/lib/roles.ts)

```ts
isAdmin(user)       // OWNER or MANAGER
isOrgOwner(user)    // OWNER only
isSuperAdmin(user)  // SYSTEM_MANAGER only
canManageUsers(user)// OWNER only
```

Used in route guards and conditional UI rendering throughout the dashboard.
