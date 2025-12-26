# Agent Dashboard - Frontend

React 18 + TypeScript agent dashboard for AI ChatAssist.

## Tech Stack

- **React 18** with TypeScript
- **Vite** for build tooling
- **Tailwind CSS** for styling
- **shadcn/ui** for UI components
- **Zustand** for state management
- **React Router** for routing
- **React Hook Form + Zod** for form validation
- **WebSocket** for real-time communication
- **Lucide React** for icons

## Features

### ✅ Authentication
- JWT-based login system
- Token persistence in localStorage
- Automatic token restoration on page refresh
- Protected routes (redirect to login if not authenticated)
- Secure logout with token cleanup

### ✅ Dashboard Layout
- Responsive header with navigation
- Agent email display
- Tabbed navigation (Active Chats, Websites)
- Logout functionality

### ✅ Active Chats Management
- Real-time list of active conversations
- Website name and message count display
- Join chat functionality
- Navigation to chat view

### ✅ Chat Interface
- Real-time WebSocket messaging
- Full conversation history
- Message type differentiation (visitor/AI/agent)
- Auto-scroll to latest message
- Send messages as agent
- Confidence score display for AI messages

### ✅ Website Management
- List all websites
- Create new websites with domain and AI instructions
- Edit existing websites
- Delete websites with confirmation
- Domain uniqueness validation
- Widget configuration preview

## Project Structure

```
src/
├── components/
│   └── ui/                      # shadcn/ui components
│       ├── button.tsx
│       ├── card.tsx
│       └── input.tsx
├── lib/
│   └── utils.ts                 # Utility functions (cn)
├── pages/
│   ├── LoginPage.tsx            # JWT authentication
│   ├── DashboardLayout.tsx      # Main layout with nav
│   ├── ActiveChats.tsx          # Chat list view
│   ├── ChatView.tsx             # Real-time chat interface
│   └── WebsiteManagement.tsx    # Website CRUD interface
├── services/
│   ├── api.ts                   # Base API client with JWT
│   ├── auth.ts                  # Authentication services
│   ├── chats.ts                 # Chat API functions
│   ├── messages.ts              # Message API functions
│   ├── websites.ts              # Website API functions
│   └── agentSocket.ts           # Agent WebSocket client
├── store/
│   ├── appStore.ts              # Global Zustand store
│   └── messages.ts              # Message store
├── types/
│   └── index.ts                 # TypeScript interfaces
├── App.tsx                      # Router and auth provider
├── main.tsx                     # App entry point
└── index.css                    # Global styles
```

## Development

### Prerequisites

- Node.js 18+
- Backend server running on `http://localhost:8000`

### Setup

```bash
# Install dependencies
npm install

# Start development server
npm run dev
```

Development server runs at `http://localhost:5173`

### Build

```bash
# Production build
npm run build

# Preview production build
npm run preview

# Lint code
npm run lint
```

## Environment Variables

Create `.env` file (optional - defaults work for local development):

```env
VITE_API_URL=http://localhost:8000
VITE_WS_URL=ws://localhost:8000
```

## Default Login Credentials

- **Email:** `agent@test.com`
- **Password:** `password`

## API Integration

### Authentication Flow

1. User submits login form
2. POST `/auth/login` with email/password
3. Backend returns JWT token
4. Token saved to localStorage
5. Token included in all subsequent API requests via `Authorization: Bearer {token}` header
6. Token restored from localStorage on page refresh
7. GET `/auth/me` fetches current agent details

### REST API Endpoints Used

```typescript
// Authentication
POST   /auth/login        // Login and get JWT token
GET    /auth/me           // Get current agent details

// Websites
GET    /websites          // List all websites
POST   /websites          // Create website
GET    /websites/{id}     // Get specific website
PUT    /websites/{id}     // Update website
DELETE /websites/{id}     // Delete website

// Chats
GET    /chats             // List active chats
POST   /chats/{id}/join   // Join chat as agent
GET    /chats/{id}        // Get chat details

// Messages
GET    /chats/{id}/messages  // Get message history
POST   /chats/{id}/messages  // Send message
```

## WebSocket Flow

### Agent Connection

1. Agent logs in and navigates to Active Chats
2. Agent clicks chat to view conversation
3. POST `/chats/{id}/join` to mark agent joining
4. WebSocket connects to `/ws/agent/{agent_id}`
5. Send `join_chat` message with conversation_id
6. Receive conversation history
7. Real-time bidirectional messaging begins
8. AI automatically pauses when agent joins

### Message Format

```typescript
// Outgoing (Agent → Backend)
{
  type: 'message',
  conversation_id: number,
  content: string
}

// Incoming (Backend → Agent)
{
  type: 'history' | 'new_message',
  conversation_id?: number,
  messages?: Message[],
  message?: Message
}
```

## State Management

### appStore (Zustand)

```typescript
interface AppStore {
  token: string | null
  agent: Agent | null
  setToken: (token: string | null) => void
  setAgent: (agent: Agent | null) => void
}
```

### messages Store (Zustand)

```typescript
interface MessagesStore {
  messages: Record<number, Message[]>
  addMessage: (conversationId: number, message: Message) => void
  setMessages: (conversationId: number, messages: Message[]) => void
}
```

## Component Overview

### LoginPage
- Email/password form with React Hook Form
- Zod validation schema
- JWT token storage
- Automatic redirect on success

### DashboardLayout
- Persistent header across all dashboard pages
- Tab navigation (Active Chats, Websites)
- Agent info display
- Logout with token cleanup

### ActiveChats
- Fetches conversations via REST API
- Card-based chat list
- Click to navigate to chat view
- Shows website name, message count, session ID

### ChatView
- WebSocket connection for real-time updates
- Message history with scroll behavior
- Input field with send button
- Message type styling (visitor/AI/agent)
- Confidence score badges for AI messages

### WebsiteManagement
- List view of all websites
- Create form with validation
- Edit form (inline or modal)
- Delete with confirmation dialog
- Domain uniqueness checking
- AI instructions text area

## Styling

- **Tailwind CSS** utility classes
- **shadcn/ui** component system
- Custom color scheme via `index.css`
- Responsive design with mobile breakpoints
- Dark mode support (future enhancement)

## Type Safety

Full TypeScript coverage with interfaces for:
- Agent
- Website
- Conversation
- Message
- WebSocket message types
- API request/response types

## Error Handling

- API request errors displayed in UI
- Form validation errors shown inline
- WebSocket connection retry logic
- Token expiration handling (redirect to login)
- Graceful fallback for failed operations

## Performance Optimizations

- React memo for expensive renders
- Debounced search inputs (future)
- Lazy loading for routes (future)
- WebSocket connection pooling
- Optimistic UI updates

## Security

- JWT tokens stored in localStorage
- Tokens included in all authenticated requests
- Protected routes with automatic redirects
- Token cleared on logout
- No sensitive data in state after logout

## Testing

```bash
# Run tests (when implemented)
npm test

# Run tests in watch mode
npm run test:watch

# Generate coverage report
npm run test:coverage
```

## Troubleshooting

### TypeScript Import Errors

If you see "does not provide an export named" errors:
- Use `import type` for type-only imports
- Restart the Vite dev server
- Clear browser cache

### WebSocket Connection Failed

- Verify backend is running on port 8000
- Check CORS configuration in backend
- Ensure WebSocket URL is correct
- Check browser console for error details

### Authentication Issues

- Verify token is saved to localStorage (check DevTools → Application → Local Storage)
- Check token expiration (24 hours)
- Ensure backend `/auth/me` endpoint is accessible
- Clear localStorage and login again

### Build Errors

```bash
# Clear node_modules and reinstall
rm -rf node_modules package-lock.json
npm install

# Clear Vite cache
rm -rf node_modules/.vite
```

## Browser Support

- Chrome/Edge 90+
- Firefox 88+
- Safari 14+
- Modern mobile browsers

## Future Enhancements

- [ ] Typing indicators
- [ ] Read receipts
- [ ] Message search
- [ ] Conversation filters
- [ ] Dark mode toggle
- [ ] Agent status (online/away/busy)
- [ ] Multiple chat windows
- [ ] Desktop notifications
- [ ] File attachments
- [ ] Conversation notes
- [ ] Chat analytics dashboard

---

**For complete project documentation, see the main [README.md](../README.md)**
