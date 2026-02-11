# AI ChatAssist - Visitor Chat Widget

Embeddable Vanilla JavaScript chat widget for website visitors. Zero dependencies, lightweight, and customizable.

## Overview

The chat widget provides a complete chat interface that connects directly to the AI ChatAssist backend via WebSocket. It handles bot automations and seamless handoff to human agents.

## ⚠️ Important: Setup Requirements

**Before the widget will work, you must:**

1. ✅ **Complete system initialization** - Run onboarding to create admin account
2. ✅ **Create a website** - Add website in Dashboard → Settings → Websites
3. ✅ **Get the widget key** - Copy the embed snippet from the dashboard (it includes a unique key)
4. ✅ **Embed widget code** - Paste the loader snippet on your site (recommended)

**The widget will NOT load if:**
- ❌ System is not initialized
- ❌ Widget key doesn't exist in database
- ❌ Backend is not running
- ❌ Widget key is incorrect
- ❌ Domain lock fails (widget key used on a different domain)

## Features

- ✅ **Real-time WebSocket messaging** - Instant bidirectional communication
- ✅ **Session persistence** - localStorage-based session management
- ✅ **Auto-reconnect** - Automatic reconnection on disconnect
- ✅ **Bot and agent support** - Handles both automated and human responses
- ✅ **Agent handoff indicator** - Visual notification when agent joins
- ✅ **Dynamic configuration** - Embedded via `loader.js` per website
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
5. Save and copy the **Widget Snippet** (includes the widget key)

### Step 3: Embed Widget

Add this code to your website's HTML (usually before `</body>`):

```html
<!-- AI ChatAssist Live Chat script -->
<script type="text/javascript">
  var _aichatassist = _aichatassist || {};
  _aichatassist.key = "YOUR_WIDGET_KEY";
  window.aichatassist||(function(d) {
    var s,c,o=aichatassist=function(){ o._.push(arguments)}; o._=[];
    s=d.getElementsByTagName('script')[0];c=d.createElement('script');
    c.type='text/javascript';c.charset='utf-8';c.async=true;
    c.referrerPolicy='origin';
    c.src='https://your-backend.com/widget/loader.js?key=' + _aichatassist.key;
    s.parentNode.insertBefore(c,s);
  })(document);
</script>
```

**Replace `YOUR_WIDGET_KEY` with the key shown in your dashboard snippet.**

## Installation

### Method 1: Loader Snippet (Recommended)

When backend is running, it serves widget files at `/widget/` endpoint:

```html
<script type="text/javascript">
  var _aichatassist = _aichatassist || {};
  _aichatassist.key = "YOUR_WIDGET_KEY";
  window.aichatassist||(function(d) {
    var s,c,o=aichatassist=function(){ o._.push(arguments)}; o._=[];
    s=d.getElementsByTagName('script')[0];c=d.createElement('script');
    c.type='text/javascript';c.charset='utf-8';c.async=true;
    c.referrerPolicy='origin';
    c.src='https://your-backend.com/widget/loader.js?key=' + _aichatassist.key;
    s.parentNode.insertBefore(c,s);
  })(document);
</script>
```

### Method 2: Direct File Serving (Advanced)

Host the files on your CDN or static server:

```html
<link rel="stylesheet" href="https://cdn.example.com/chat-widget.css">
<script>
  window._aichatassist = {
    websiteId: 1,
    widgetKey: "YOUR_WIDGET_KEY",
    apiUrl: "https://your-backend.com",
    wsUrl: "wss://your-backend.com",
  };
</script>
<script src="https://cdn.example.com/chat-widget.js"></script>
```

## Configuration

### Required Configuration

The recommended loader snippet only needs the widget key (`YOUR_WIDGET_KEY`).

If you directly host `chat-widget.js`, you must provide a global config object:

- `window._aichatassist.websiteId`
- `window._aichatassist.widgetKey`
- `window._aichatassist.apiUrl`
- `window._aichatassist.wsUrl`

### Optional Attributes

If you use the loader snippet, no additional attributes are required.

### Example Configurations

**Development (loader):**
```html
<script type="text/javascript">
  var _aichatassist = _aichatassist || {};
  _aichatassist.key = "YOUR_WIDGET_KEY";
  window.aichatassist||(function(d) {
    var s,c,o=aichatassist=function(){ o._.push(arguments)}; o._=[];
    s=d.getElementsByTagName('script')[0];c=d.createElement('script');
    c.type='text/javascript';c.charset='utf-8';c.async=true;
    c.referrerPolicy='origin';
    c.src='http://localhost:8000/widget/loader.js?key=' + _aichatassist.key;
    s.parentNode.insertBefore(c,s);
  })(document);
</script>
```

**Production (loader):**
```html
<script type="text/javascript">
  var _aichatassist = _aichatassist || {};
  _aichatassist.key = "YOUR_WIDGET_KEY";
  window.aichatassist||(function(d) {
    var s,c,o=aichatassist=function(){ o._.push(arguments)}; o._=[];
    s=d.getElementsByTagName('script')[0];c=d.createElement('script');
    c.type='text/javascript';c.charset='utf-8';c.async=true;
    c.referrerPolicy='origin';
    c.src='https://api.example.com/widget/loader.js?key=' + _aichatassist.key;
    s.parentNode.insertBefore(c,s);
  })(document);
</script>
```

## Dynamic Widget Configuration

The widget automatically fetches per-website configuration from the backend:

### Session ID Generation
- Generates UUID v4 session ID on first visit
- Stored in `localStorage` as `ai_chatassist_session_id_{websiteId}`
- Reuses same session across:
  - Page reloads
  - Browser tabs (same domain)
  - Multiple visits
- New session only created when localStorage is cleared

### WebSocket Connection
- Connects to `/ws/chat/{website_id}/{session_id}`
- Automatic reconnection on disconnect
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
