# Embedding the Widget

The chat widget is a self-contained JavaScript file that you embed on any website. It connects directly to your AI ChatAssist backend via WebSocket.

## Basic embed

Paste this snippet before the closing `</body>` tag on every page where you want the widget:

```html
<script>
  window.AIChatConfig = {
    websiteId: "YOUR_WEBSITE_ID",
    widgetKey: "YOUR_WIDGET_KEY",
    apiUrl: "https://api.yourdomain.com"
  };
</script>
<script src="https://api.yourdomain.com/widget/chat-widget.js" async></script>
```

Replace:
- `YOUR_WEBSITE_ID` — found in **Settings → Websites → [your website] → General**
- `YOUR_WIDGET_KEY` — found in the same place
- `api.yourdomain.com` — your backend domain

## Configuration options

All options are set via `window.AIChatConfig` before the script loads.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `websiteId` | string | **required** | Your website ID |
| `widgetKey` | string | **required** | Your widget authentication key |
| `apiUrl` | string | **required** | Your backend base URL |
| `position` | `"bottom-right"` \| `"bottom-left"` | From website settings | Widget bubble position |

Most visual settings (colours, title, welcome message, sounds) are controlled from the dashboard in **Settings → Websites → [your website] → Widget** — not from the embed code. This means you can update the widget appearance without touching your website.

## Security

The widget is only allowed to load on the domain you registered in **Settings → Websites → [your website] → Domain**. Requests from other origins are rejected by the backend. This prevents your widget key from being used on unauthorised websites.

## How the widget works

1. On page load, the widget reads `window.AIChatConfig` and calls `GET /widget/loader/{website_id}` to fetch the latest appearance config.
2. It renders a chat bubble in the page corner.
3. When the visitor opens the widget, it establishes a WebSocket connection to `/ws/chat/{website_id}`.
4. A `session_id` (UUID) is generated and stored in `sessionStorage` — this persists across page reloads within the same browser tab.
5. Messages are sent and received over the WebSocket.

## Session persistence

| Storage | What is stored |
|---------|---------------|
| `sessionStorage` | `session_id` — identifies the visitor within the session |
| `localStorage` | Unread count, draft messages, widget open/closed state, conversation history state |

Closing and reopening the browser tab starts a fresh session. This is by design — visitors expect a fresh start when they come back.

## Conversation history

If **Conversation History** is enabled in website settings, returning visitors can see their previous chats by clicking the history icon in the widget header. They can also start a new conversation from the history list.

## Offline state

When no agents are online (based on presence heartbeats), the widget shows an offline indicator and can display an offline form for visitors to leave their contact details.
