# Embedding the Widget

The AI ChatAssist widget is a self-contained chat application that you can embed on any website to provide real-time visitor support.

---

## Standard Implementation

To deploy the widget, insert the following snippet before the closing `</body>` tag of your website.

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

### Where to find your credentials
- **websiteId** and **widgetKey** — go to **Settings → Websites → [Your Website] → Widget → Embed Code**. Both values are pre-filled in the snippet shown there; simply copy and paste.
- **apiUrl** — the base URL of your AI ChatAssist installation, provided by your administrator.

---

## Configuration Reference

All widget behaviour is initialized via the `window.AIChatConfig` object.

| Option | Type | Requirement | Description |
| :--- | :--- | :--- | :--- |
| `websiteId` | string | **Required** | Connects the widget to the correct website in your account. |
| `widgetKey` | string | **Required** | Authorizes the widget's connection to the chat service. |
| `apiUrl` | string | **Required** | The endpoint for your AI ChatAssist installation. |
| `position` | string | Optional | Overrides the dashboard-configured position (`bottom-right` or `bottom-left`). |

> **Dynamic updates**: Visual and behavioural settings (colors, title, sounds, automations) are managed from the dashboard. Changes take effect without editing your website's code.

---

## Security & Domain Allowlist

The widget only initialises on domains that are explicitly whitelisted in your Website Settings. Requests from unlisted origins are rejected automatically.

**To add a domain:**
1. Go to **Settings → Websites → [Your Website]**.
2. Open the **Allowed Domains** tab.
3. Add each domain where the widget is embedded (e.g. `www.yourdomain.com`).

> When testing on a local or staging environment, add that domain (e.g. `localhost:3000`) to the allowlist.
