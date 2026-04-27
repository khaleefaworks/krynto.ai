# Managing Websites

A Website represents a digital property where the chat widget is deployed. You can manage multiple sites under one organization with unique settings.

---

## Initial Setup

### Adding a New Website
Follow these steps to register a new website:
- **Step 1**: Navigate to **Settings > Websites** and select **Add Website**.
- **Step 2**: Enter the **Name** of your website for internal identification.
- **Step 3**: Enter the primary **Domain** (e.g., `example.com`).
- **Step 4**: Save the changes to generate your unique **Widget Key** and **ID**.

---

## Widget Customization

The **Widget** tab allows you to define the visitor-facing experience. A real-time preview is provided within the dashboard to validate your changes instantly.

### Visual and Functional Settings
| Feature | Configuration Detail |
| :--- | :--- |
| **Theme Identity** | Set the primary brand color for the widget header, icons, and action buttons. |
| **Interface Position** | Choose between **Bottom-Right** (default) or **Bottom-Left** placement. |
| **Messaging** | Configure the **Widget Title** and the initial **Welcome Message** that greets new visitors. |
| **History Persistence** | Toggle whether returning visitors can view and continue their previous conversation threads. |
| **Audio Cues** | Customize the sounds played for incoming messages when the widget is in either a collapsed or expanded state. |
| **Visual Prompts** | Enable notification bubbles that appear above the chat icon to capture visitor attention. |

---

## Installation & Deployment

To activate AI ChatAssist on your property, you must embed the following script before the closing `</body>` tag on every page where you want the chat to appear.

### Embed Snippet
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

---

## Routing and Assignments

### Agent & Team Logic
Proper routing ensures that the right people handle the right queries:
- **Direct Assignments**: In the **Agents** tab, you can manually assign individual agents to a website.
- **Team-Based Routing**: Assign one or more teams to a website. When a team is assigned, only its members will receive notifications and access to conversations for that property.

---

## Advanced Website Features

### Office Hours
Define the operational window for each website. During "Off" hours, the widget will automatically transition to an offline state, displaying a lead-capture form instead of a live chat interface.

### Automations and Tags
- **Triggered Events**: Link website-specific [Automations](./automations) to send proactive messages based on visitor behavior.
- **Categorization**: Manage the list of Tags available for agents to categorize conversations on a per-website basis.

### Response Shortcuts
Configure canned responses (Shortcuts) tailored to the specific needs of the website's audience, allowing agents to respond to common queries with greater speed and consistency.

> **Domain Enforcement**: Ensure the **Domain** setting matches exactly where the widget is hosted. If the domains do not match, the browser will block the widget from communicating with the AI ChatAssist API.
