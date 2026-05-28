# Notifications

AI ChatAssist ensures your team stays responsive through a robust notification system including push alerts and audio cues.

---

## Push Notifications

Push notifications are delivered directly by your browser, ensuring you receive alerts even when the dashboard tab is in the background or minimized.

### Notification Triggers
Push notifications are dispatched in the following scenarios:
- **New Conversation**: A visitor initiates a chat on a website you are assigned to.
- **New Message**: A visitor sends a message in a conversation that is specifically assigned to you.

### Notification Routing Logic
To prevent alert fatigue, notifications are routed based on your role and team membership:

| Your Status | Notification Eligibility |
| :--- | :--- |
| **Owner / Manager** | Receive alerts for all conversations across every website in the organization. |
| **Team Member** | Receive alerts for unassigned conversations and conversations within your specific team. |
| **Individual Agent** | Receive alerts for all unassigned conversations on your assigned websites. |
| **Assigned Agent** | Once you join a chat, you are the exclusive recipient of notifications for that thread. |

> **Spectating**: If you view a conversation that you are not responsible for, you will see real-time updates within the dashboard, but you will not receive system push notifications or unread count increments.

---

## Unread Indicators

Unread badges provide a visual cue for pending interactions. These counts follow the same routing rules as push notifications—they only increment for conversations where you are the responsible agent or a relevant team member.

---

## Audio Notifications

Audio alerts provide immediate feedback for activity within the dashboard. These can be customized in **Settings > Notifications > Sounds**.

### Standard Audio Triggers
| Trigger Event | Description |
| :--- | :--- |
| **New Chat** | Plays when a new visitor initiates a session on your website. |
| **New Message** | Plays when a visitor sends a message in a conversation assigned to you. |
| **New Visitor** | Plays when a new visitor lands on the site (Active only when the Visitors tab is open). |

### Customization Options
- **Sound Profiles**: Choose from 12 distinct audio profiles or set specific triggers to silent.
- **Audio Rate-Limiting**: To prevent overlapping sounds, audio alerts are limited to once every 1.5 seconds.

---

## Setup & Configuration

### Enabling Browser Alerts
Follow these steps to enable push notifications:
- **Step 1**: Navigate to **Settings > Notifications**.
- **Step 2**: Toggle the **Enable push notifications** switch to the ON position.
- **Step 3**: When the browser prompts for permission, click **Allow**.

> If you previously blocked notification permissions, you must manually reset them in your browser's site settings (usually found by clicking the lock icon in the address bar).

---

## Synchronization & Device Settings

Your notification preferences are securely stored in the cloud and synchronized across all your devices. When you log in on a new browser or machine, your custom sound profiles and alert toggles are automatically applied.

> **Test Your Setup**: Use the "Test Notification" button in the settings panel to ensure your browser and operating system are correctly delivering alerts.

---

## Installing as a PWA

For the best notification experience — especially on mobile — install ChatAssist as a Progressive Web App (PWA). This gives the app its own window and enables push alerts even when no browser tab is open.

See the [Install as PWA](../getting-started/install-pwa) guide for step-by-step instructions for all browsers and platforms.
