# Notifications

AI ChatAssist notifies agents through two channels: **browser push notifications** (works even when the tab is closed) and **in-browser sounds**.

## Push notifications

Push notifications appear as system-level browser notifications. They fire when:
- A new visitor starts a chat on one of your assigned websites
- A visitor sends a message in a conversation assigned to you

**Scope rules:**
- You only receive push notifications for websites you are assigned to.
- If your website uses teams, you only receive notifications for conversations in your team.
- Spectating agents do not receive push notifications — only the assigned agent does.

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
