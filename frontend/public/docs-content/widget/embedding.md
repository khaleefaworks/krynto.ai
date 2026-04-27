# Embedding the Widget

The AI ChatAssist widget is a self-contained JavaScript application that you can embed on any website to provide real-time support.

---

## Standard Implementation

To deploy the widget, insert the following configuration and script tags before the closing `</body>` tag of your website.

### Deployment Snippet
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

### Required Variables
- **websiteId**: The unique identifier for your website, found in the Website Settings panel.
- **widgetKey**: A secure authentication key used to authorize the widget's connection to the API.
- **apiUrl**: The base URL of your AI ChatAssist backend installation.

---

## Configuration Reference

All widget behavior is initialized via the `window.AIChatConfig` object.

| Option | Type | Requirement | Description |
| :--- | :--- | :--- | :--- |
| `websiteId` | string | **Required** | Connects the widget to the correct organizational entity. |
| `widgetKey` | string | **Required** | Authorizes API requests and WebSocket handshakes. |
| `apiUrl` | string | **Required** | Defines the endpoint for configuration fetching and real-time communication. |
| `position` | string | Optional | Overrides the default dashboard-configured position (`bottom-right` or `bottom-left`). |

> **Dynamic Updates**: Most visual and behavioral settings (colors, titles, sounds) are managed directly from the dashboard. This allows you to update the widget's appearance in real-time without modifying your website's source code.

---

## Technical Architecture

The widget follows a precise initialization sequence to ensure zero impact on your site's performance:

1. **Lazy Loading**: The script loads asynchronously (`async`) to prevent blocking the main thread.
2. **Configuration Fetch**: Upon initialization, the widget calls the `/widget/loader/` endpoint to retrieve the latest appearance and automation settings.
3. **Real-Time Handshake**: When a visitor opens the chat interface, the widget establishes a dedicated WebSocket connection for instantaneous message delivery.
4. **Session Initialization**: A unique session UUID is generated to track the visitor's journey and preserve conversation continuity.

---

## Session Persistence & Storage

To provide a seamless user experience, the widget utilizes standard browser storage mechanisms:

| Storage Type | Data Stored | Lifecycle |
| :--- | :--- | :--- |
| **Session Storage** | `session_id` | Cleared when the browser tab is closed. |
| **Local Storage** | Widget State, Unread Counts, History State | Persists across browser restarts. |

---

## Security & Origin Enforcement

AI ChatAssist employs strict **Origin-Based Security**. The widget is only permitted to initialize and communicate with the API if it is loaded from a domain explicitly whitelisted in your Website Settings. Requests from unauthorized origins are automatically rejected by the backend to prevent unauthorized use of your widget key.

> **Development Testing**: When testing the widget on a local or staging environment, ensure that those specific domains (e.g., `localhost:3000` or `staging.example.com`) are added to the allowed domains list in the dashboard.
