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

## Project Structure

```
src/
├── components/
│   └── ui/              # shadcn/ui components
│       ├── button.tsx
│       ├── card.tsx
│       └── input.tsx
├── lib/
│   └── utils.ts         # Utility functions
├── pages/
│   ├── LoginPage.tsx
│   ├── DashboardLayout.tsx
│   ├── ActiveChats.tsx
│   └── ChatView.tsx
├── store/
│   └── appStore.ts      # Zustand store
├── App.tsx
├── main.tsx
└── index.css
```

## Development

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview
```

## Features

### ✅ Implemented

1. **Login Page**
   - Email/password form validation with Zod
   - Mock authentication (TODO: integrate real API)

2. **Dashboard Layout**
   - Header with agent email and logout
   - Navigation structure

3. **Active Chats List**
   - Fetches active conversations from REST API
   - Shows message count and status
   - Join/View chat buttons

4. **Chat View**
   - Real-time WebSocket connection
   - Message history display
   - Send/receive messages
   - Auto-scroll to latest message
   - Differentiated styling for visitor/AI/agent messages

## Environment Variables

Create `.env` file:

```env
VITE_API_URL=http://localhost:8000
VITE_WS_URL=ws://localhost:8000
```

## WebSocket Flow

1. Agent logs in → navigates to chats list
2. Agent clicks "Join Chat"
3. POST `/chats/{id}/join` to mark handoff
4. WebSocket connects to `/ws/agent/{website_id}/{agent_id}`
5. Sends `join_chat` message
6. Receives conversation history
7. Real-time bidirectional messaging begins

## Next Steps

- [ ] Replace mock authentication with real JWT
- [ ] Add loading states and error handling
- [ ] Implement typing indicators
- [ ] Add conversation metadata (visitor info, website name)
- [ ] Add conversation close/transfer functionality
- [ ] Implement proper environment configuration

      tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```

You can also install [eslint-plugin-react-x](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```
