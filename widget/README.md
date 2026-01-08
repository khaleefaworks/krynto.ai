# AI ChatAssist - Visitor Chat Widget

Embeddable Vanilla JavaScript chat widget for website visitors. Zero dependencies, lightweight, and customizable.

## Overview

The chat widget provides a complete chat interface that connects directly to the AI ChatAssist backend via WebSocket. It handles AI responses and seamless handoff to human agents.

## ⚠️ Important: Setup Requirements

**Before the widget will work, you must:**

1. ✅ **Complete system initialization** - Run onboarding to create admin account
2. ✅ **Create a website** - Add website in Dashboard → Settings → Websites
3. ✅ **Get website ID** - Note the ID assigned to your website (e.g., 1, 2, 3...)
4. ✅ **Embed widget code** - Use the correct website ID in the embed code

**The widget will NOT load if:**
- ❌ System is not initialized
- ❌ Website ID doesn't exist in database
- ❌ Backend is not running
- ❌ Website ID is incorrect

## Features

- ✅ **Real-time WebSocket messaging** - Instant bidirectional communication
- ✅ **Session persistence** - localStorage-based session management
- ✅ **Auto-reconnect** - Automatic reconnection on disconnect
- ✅ **AI and agent support** - Handles both automated and human responses
- ✅ **Agent handoff indicator** - Visual notification when agent joins
- ✅ **Dynamic configuration** - Fetches styling from backend per website
- ✅ **Website validation** - Verifies website exists before loading
- ✅ **Responsive design** - Works on desktop and mobile
- ✅ **No dependencies** - Pure Vanilla JS + CSS (3KB gzipped)
- ✅ **Collision-free** - All IDs and classes namespaced

## Files

- `chat-widget.js` - Core widget logic (4.5KB minified)
- `chat-widget.css` - Widget styles (2KB minified)
- `demo.html` - Demo page for testing
- `README.md` - This file

## Quick Start Guide

### Step 1: Initialize System

1. Start the backend server:
   ```bash
   cd backend
   ./start_server.sh
   ```

2. Start the frontend:
   ```bash
   cd frontend
   npm run dev
   ```

3. Complete onboarding at `http://localhost:5173/login`

### Step 2: Create a Website

1. Log in to the dashboard
2. Navigate to **Settings → Websites**
3. Click **Add Website**
4. Fill in:
   - Name: "My Website"
   - Domain: "example.com"
   - AI Instructions: (optional)
5. Save and note the **Website ID** (e.g., ID: 1)

### Step 3: Embed Widget

Add this code to your website's HTML (usually before `</body>`):

```html
<!-- Widget Styles -->
<link rel="stylesheet" href="<YOUR_BACKEND_BASE_URL>/widget/chat-widget.css">

<!-- Widget Script -->
<script 
  src="<YOUR_BACKEND_BASE_URL>/widget/chat-widget.js" 
  data-website-id="1"
  data-ws-url="<YOUR_WS_BASE_URL>"
  data-api-url="<YOUR_BACKEND_BASE_URL>">
</script>
```

**Replace `data-website-id="1"` with your actual website ID!**

## Installation

### Method 1: Backend Static Files (Recommended)

When backend is running, it serves widget files at `/widget/` endpoint:

```html
<!-- Widget Styles -->
<link rel="stylesheet" href="http://your-backend.com/widget/chat-widget.css">

<!-- Widget Script -->
<script 
  src="http://your-backend.com/widget/chat-widget.js" 
  data-website-id="1"
  data-ws-url="ws://your-backend.com"
  data-api-url="http://your-backend.com">
</script>
```

### Method 2: Direct File Serving

Host the files on your CDN or static server:

```html
<link rel="stylesheet" href="https://cdn.example.com/chat-widget.css">
<script 
  src="https://cdn.example.com/chat-widget.js" 
  data-website-id="1"
  data-ws-url="ws://your-backend.com"
  data-api-url="http://your-backend.com">
</script>
```

## Configuration

### Required Attributes

| Attribute | Description | Example |
|-----------|-------------|---------|
| `data-website-id` | Your website ID from backend | `"1"` |

### Optional Attributes

| Attribute | Description | Default |
|-----------|-------------|---------|
| `data-ws-url` | WebSocket server URL | `"ws://your-backend.example.com"` |
| `data-api-url` | REST API base URL | `"https://your-backend.example.com"` |

### Example Configurations

**Development:**
```html
<script 
  src="<YOUR_BACKEND_BASE_URL>/widget/chat-widget.js" 
  data-website-id="1"
  data-ws-url="<YOUR_WS_BASE_URL>"
  data-api-url="<YOUR_BACKEND_BASE_URL>">
</script>
```

**Production:**
```html
<script 
  src="https://chat.example.com/widget/chat-widget.js" 
  data-website-id="42"
  data-ws-url="wss://chat.example.com"
  data-api-url="https://chat.example.com">
</script>
```

## Dynamic Widget Configuration

The widget automatically fetches per-website configuration from the backend:

### Session ID Generation
- Generates UUID v4 session ID on first visit
- Stored in `localStorage` as `ai_chatassist_session_{websiteId}_id`
- Reuses same session across:
  - Page reloads
  - Browser tabs (same domain)
  - Multiple visits
- New session only created when localStorage is cleared

### WebSocket Connection
- Connects to `/ws/chat/{website_id}?session_id={session_id}`
- Automatic reconnection on disconnect (exponential backoff)
- Connection status indicator in UI
- Maintains message queue during disconnections

## Message Flow

### Visitor → Backend

```javascript
{
  "message": "How can I reset my password?"
}
```

### Backend → Visitor

**AI Response:**
```javascript
{
  "type": "ai",
  "sender": "ai",
  "message": "To reset your password, click...",
  "confidence": 0.95
}
```

**Agent Joins:**
```javascript
{
  "type": "agent_joined",
  "message": "Sarah has joined the chat"
}
```

**Agent Message:**
```javascript
{
  "type": "agent",
  "sender": "agent",
  "message": "Hi! I'm here to help.",
  "sender_name": "Sarah"
}
```

## Widget Lifecycle

```
1. Script loads → Parse data attributes
2. Fetch widget config from API
3. Apply theme/colors/position
4. Generate or retrieve session ID
5. Render chat bubble (minimized)
6. User clicks bubble
7. Show chat window
8. Connect WebSocket
9. Display welcome message
10. Ready to send/receive messages
```

## UI States

### Minimized (Bubble)
- Small circular button with chat icon
- Positioned per configuration
- Click to expand

### Expanded (Window)
- Full chat interface
- Header with minimize/close
- Scrollable message area
- Input field with send button
- Connection status indicator

### Agent Joined
- System message displayed
- AI pauses automatically
- All messages from agent
- Yellow badge for agent messages

## Styling & Theming

Widget uses CSS custom properties for easy customization:

```css
/* Applied dynamically from backend config */
#chatassist-widget {
  --primary-color: #3b82f6;
  --text-color: #000000;
  --bg-color: #ffffff;
}
```

### Theme Options

**Light Theme:**
- White background
- Dark text
- Bright primary color

**Dark Theme:**
- Dark gray background (#1f2937)
- Light text (#f3f4f6)
- Accent primary color

### Position Options

- `bottom-right` - Default, common for chat widgets
- `bottom-left` - Alternative bottom position
- `top-right` - Less common, useful for some layouts
- `top-left` - Rare, specific use cases
- Generates UUID session ID on first visit
- Stores in `localStorage` as `ai_chatassist_session_id`
- Reuses same session across page reloads
- Reconnects automatically if connection drops

## Message Types

Widget handles these message types from backend:

```javascript
// AI response
{ "type": "ai", "message": "..." }

// Agent message
{ "type": "agent", "message": "..." }

// Agent joined
{ "type": "agent_joined", "message": "..." }

// Generic format
{ "sender": "ai|agent", "message": "..." }
```

## Sending Messages

Widget sends messages in this format:

```javascript
{ "message": "user's message text" }
```

## Styling

Widget uses CSS custom properties for easy theming. All styles are scoped with `#chatassist-` prefix to avoid conflicts.

## Browser Support

- Chrome/Edge (latest)
- Firefox (latest)
- Safari (latest)
- Mobile browsers

## Architecture

```
┌─────────────────┐
│  Website Page   │
└────────┬────────┘
         │ embeds
         ▼
┌─────────────────┐
│  Chat Widget    │
│  (Vanilla JS)   │
└────────┬────────┘
         │ WebSocket
         ▼
┌─────────────────┐
│  Backend API    │
│  /ws/chat/...   │
└─────────────────┘
```

## Next Steps

See main PRD for:
- Task 2: Enhanced UI/UX
- Task 3: Advanced session management
- Task 4: Multi-website embed API
- Task 5: End-to-end validation
