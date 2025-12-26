# AI ChatAssist - Visitor Chat Widget

## Overview

Standalone Vanilla JavaScript chat widget for website visitors. Connects to the AI ChatAssist backend via WebSocket.

## Files

- `chat-widget.js` - Core widget logic (WebSocket, messaging, session management)
- `chat-widget.css` - Widget styles (plain CSS, no frameworks)
- `demo.html` - Demo page for testing
- `README.md` - This file

## Installation

### Basic Usage

Add to your website's HTML:

```html
<!-- Widget Styles -->
<link rel="stylesheet" href="https://your-domain.com/widget/chat-widget.css">

<!-- Widget Script -->
<script 
  src="https://your-domain.com/widget/chat-widget.js" 
  data-website-id="YOUR_WEBSITE_ID"
  data-ws-url="ws://your-backend.com"
  data-api-url="http://your-backend.com">
</script>
```

## Configuration

### Required Attributes

- `data-website-id` - Your website ID from the AI ChatAssist system

### Optional Attributes

- `data-ws-url` - WebSocket URL (default: `ws://localhost:8000`)
- `data-api-url` - REST API URL (default: `http://localhost:8000`)

## Features

- ✅ Real-time WebSocket messaging
- ✅ Session persistence (localStorage)
- ✅ Auto-reconnect on disconnect
- ✅ AI and human agent support
- ✅ Responsive design
- ✅ No dependencies
- ✅ Pure Vanilla JS + CSS

## Testing Locally

1. Start backend server:
   ```bash
   cd backend
   ./start_server.sh
   ```

2. Open `demo.html` in browser:
   ```bash
   open demo.html
   # or
   python -m http.server 8080
   # then visit http://localhost:8080/demo.html
   ```

3. Click chat bubble and send messages

## Session Management

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
