# Agents and Roles

AI ChatAssist uses a role-based access control system to manage team permissions and website access.

---

## Organizational Roles

| Role | Scope | Core Capabilities |
| :--- | :--- | :--- |
| **Owner** | Organization-wide | Full administrative control — websites, billing, agents, org settings, security. |
| **Manager** | Organization-wide | Oversees agents and conversations. Can manage team assignments; no access to billing or global security settings. |
| **Agent** | Website-specific | Front-line support. Access is limited to conversations and data for websites explicitly assigned to them. |
| **System Manager** | Platform-wide | Specialized maintenance role with access to all organizations and system-level statistics. Only accessible via the `/superadmin` area. |

---

## Inviting New Team Members

1. Navigate to **Settings → Users** and click **Invite Agent**.
2. Enter the user's full name and email address.
3. Select the appropriate **Role**.
4. Click **Send Invite** — an email with a verification link is dispatched automatically.

> **Email Verification:** Invited users must click the link in the invitation email before they can access the dashboard. The link expires after a short window; you can resend it from the user management panel if needed.

---

## Access Control & Website Assignments

New agents are not assigned to any website by default. Access must be granted explicitly.

**To assign an agent to a website:**
1. Go to **Settings → Websites** and select the target property.
2. Navigate to the **Agents** tab.
3. Toggle the switch next to the agent's name to grant or revoke access.

Once assigned, the agent enters the routing pool and starts receiving notifications for that website.

---

## Presence and Availability

The **Availability Toggle** in the agent sidebar controls real-time routing:

| Status | Effect |
| :--- | :--- |
| **Available** | Agent is active and eligible for new conversation assignments. |
| **Away** | Agent is excluded from new assignments. Existing conversations remain; new alerts are paused. |

If all agents on a website are **Away** or the current time is outside configured **Office Hours**, the widget automatically switches to offline mode.

---

## Security and Account Management

### Account Status

Owners and Managers can deactivate or lock user accounts from the **User Management** panel. A deactivated account is immediately logged out, blocked from further access, and removed from all routing pools.

### Account Lockout

To protect against brute-force attacks, the system automatically locks accounts on repeated failed logins:

| Failed Attempts | Lockout Duration |
| :--- | :--- |
| 3 consecutive failures | 5-minute temporary lockout |
| 6 consecutive failures | 24-hour lockout |

Owners and Managers can manually unlock a locked account from the User Management panel. The lock clears automatically once the lockout period expires.

### Password Management

- **Self-Service:** Users update their own password via **Settings → Profile**.
- **Administrative Reset:** Owners can trigger a password reset for any user from the User Management panel.

> **Owner Protection:** Owners cannot deactivate their own account. To transfer ownership, promote another user to Owner first.
