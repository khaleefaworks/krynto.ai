# Install as PWA

AI ChatAssist can be installed as a **Progressive Web App (PWA)** on your desktop or mobile device. Once installed, it works like a native app — its own window, home-screen icon, and instant launch with no browser chrome in the way.

---

## Why Install?

| Benefit | Detail |
| :--- | :--- |
| **Instant access** | Launch from your taskbar or home screen — no URL to type. |
| **Dedicated window** | Runs in its own window, separate from your browser tabs. |
| **Push notifications** | Receive alerts even when the app window is closed. |
| **Offline resilience** | The app loads immediately even on flaky connections. |

---

## Install from the Dashboard Sidebar

The easiest way to install is via the **Install App** button built into the dashboard:

1. Open the dashboard at your ChatAssist URL.
2. Look for the **download icon (⬇)** in the sidebar — it appears automatically when your browser supports PWA installation and the app is not yet installed.
3. Click it and follow the browser prompt to confirm.
4. The button disappears once the app is installed.

---

## Install via Browser

### Chrome / Edge (Desktop)

1. Visit the dashboard URL in Chrome or Edge.
2. Look for the **install icon** (a monitor with a down-arrow) in the browser address bar.
3. Click it, then click **Install** in the popup.

Alternatively:
- Chrome: **⋮ Menu → Save and share → Install page as app**
- Edge: **⋯ Menu → Apps → Install this site as an app**

### Chrome (Android)

1. Open the dashboard in Chrome.
2. Tap **⋮ Menu → Add to Home screen**.
3. Confirm the name and tap **Add**.

The app icon will appear on your home screen and in the app drawer.

### Safari (iOS / iPadOS)

1. Open the dashboard in Safari.
2. Tap the **Share button** (box with upward arrow).
3. Scroll down and tap **Add to Home Screen**.
4. Edit the name if desired and tap **Add**.

> **Note:** On iOS, use the Safari Share menu — the in-sidebar install button is not available on this platform.

### Firefox

Firefox on desktop does not support PWA installation natively. Use Chrome or Edge for the best PWA experience.

---

## Push Notifications

Push notifications let you receive new chat alerts even when the dashboard is closed.

### Enable Notifications

1. Navigate to **Settings → Notifications**.
2. Toggle **Enable push notifications** to ON.
3. When the browser asks for permission, click **Allow**.

> If you previously clicked **Block**, reset the permission manually:
> - **Chrome/Edge:** Click the 🔒 lock icon in the address bar → **Site settings** → set Notifications to **Allow**.
> - **Firefox:** Click the lock icon → **Connection secure** → **More information** → **Permissions**.
> - **Safari (Mac):** Safari menu → **Settings for this website** → Notifications → **Allow**.

### What Triggers a Push?

| Event | Who receives it |
| :--- | :--- |
| **New conversation** | All agents eligible for the website (respects team routing). |
| **New message** | The assigned agent only. |

Clicking a push notification opens the dashboard directly to that conversation.

### Test Your Setup

Use the **Test Notification** button in **Settings → Notifications** to send a sample push to your device and confirm delivery end-to-end.

### Notification Sounds

Sound alerts complement push notifications when the dashboard is open. Configure profiles in **Settings → Notifications → Sounds**. Twelve audio profiles are available, or set individual triggers to silent.

---

## Troubleshooting

| Problem | Solution |
| :--- | :--- |
| Install button not visible | Your browser may not support PWA install, or the app is already installed. |
| Push permission was denied | Reset in browser site settings (see above), then re-enable from Settings. |
| Notifications not arriving | Check that browser permissions are set to Allow. If the problem persists, contact your administrator. |
| iOS notifications not working | Web Push on iOS requires iOS 16.4 or later. Install the app via Safari's Add to Home Screen first, then enable notifications from within the installed app. |
| App opens in browser tab, not standalone | Uninstall and reinstall the PWA from the browser. |
