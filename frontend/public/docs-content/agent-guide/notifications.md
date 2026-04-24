# Notifications

AI ChatAssist notifies agents through two channels: **browser push notifications** (works even when the tab is closed) and **in-browser sounds**.

## Push notifications

Push notifications appear as system-level browser notifications. They fire when:
- A new visitor starts a chat on one of your assigned websites
- A visitor sends a message in a conversation you are responsible for

### Who receives push notifications

**Website without teams:**
- All agents assigned to that website receive push for every new and unassigned conversation.
- Once an agent joins a conversation, only that agent receives push for subsequent messages.

**Website with teams:**

| Your situation | When you get push |
|---|---|
| Member of Team A | Unassigned conversations + Team A conversations (until an agent joins) |
| No team membership on this website | Unassigned conversations only |
| Owner / Manager | All conversations on all your organisation's websites |

> **Spectating:** If you open a conversation you are not responsible for (different team, or you're not the assigned agent), you see live updates but receive no push notification and no unread count.

### Unread counts

Unread counts follow the same rules as push notifications — they increment only when you are responsible for the conversation. Spectating agents always see an unread count of 0.

### Enable push notifications

1. Go to **Settings → Notifications**.
2. Toggle **Enable push notifications** on.
3. When the browser permission dialog appears, click **Allow**.

> If you previously denied the browser permission, you need to reset it in your browser's site settings.

### Clicking a push notification

Clicking the notification opens the dashboard and navigates directly to that conversation.

## Notification sounds

Sounds are configured under **Settings → Notifications → Sounds**.

| Sound trigger | Description |
|--------------|-------------|
| **New chat** | Plays when a new visitor starts a conversation on your website |
| **New message** | Plays when a visitor sends a message in a conversation assigned to you |
| **New visitor on website** | Plays only when you have the Visitors tab open |

You can set a different sound for each trigger (12 options + silent) and preview them before saving.

**Sound gate:** sounds are rate-limited to once every 1.5 seconds to prevent stacking when many messages arrive at once.

## Per-device settings

Notification preferences are stored in the database and synced to `localStorage` on login. Your preferences follow you across devices and browsers automatically.
