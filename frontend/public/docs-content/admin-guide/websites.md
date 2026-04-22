# Websites

Each **Website** represents a site where you embed the chat widget. You can have multiple websites under one organisation, each with its own widget configuration, team, automations, and agent assignments.

## Creating a website

1. Go to **Settings → Websites** and click **Add website**.
2. Enter the website name and domain (e.g. `example.com`).
3. Save — a unique `widget_key` is generated automatically.

## Website tabs

### General

- **Website name** — display name in the dashboard
- **Domain** — the origin that the widget is allowed to load from (CORS enforcement)
- **Office hours** — set days and hours when agents are considered available; outside these hours the widget shows the offline form

### Widget

Customise everything the visitor sees:

| Setting | Description |
|---------|-------------|
| **Theme colour** | Primary colour for the widget header, buttons, and popup |
| **Position** | Bottom-right or bottom-left |
| **Widget title** | Shown in the widget header |
| **Welcome message** | First message visible before the visitor types |
| **Conversation history** | Let returning visitors see their previous chats |
| **Sound (collapsed)** | Sound played when a new message arrives and the widget is collapsed |
| **Sound (open)** | Sound played when a new message arrives and the widget is open |
| **Notification popup** | Small bubble above the chat icon when a new message arrives |

A live preview updates as you change settings.

### Teams

Assign one or more teams to this website. When teams are configured, only agents who are members of an assigned team will receive chats from this website.

### Automations

Rule-based auto-messages triggered by visitor events. See [Automations](./automations).

### Tags

Manage conversation tags available for this website.

### Shortcuts

Canned responses (shortcuts) agents can use in this website's conversations.

## Widget embed code

After creating a website, go to **Settings → Websites → [your website] → General** and copy the embed snippet. Paste it before the closing `</body>` tag on your website:

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

## Agent assignments

Go to **Settings → Websites → [your website] → Agents** to assign or unassign agents. Only assigned agents appear in the routing pool for that website.
