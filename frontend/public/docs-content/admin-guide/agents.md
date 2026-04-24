# Agents & Roles

## Roles

| Role | Scope | Capabilities |
|------|-------|-------------|
| **System Manager** | Platform-wide | Manage all organisations, users, platform stats. Has a separate `/superadmin` interface. `organization_id = NULL`. |
| **Owner** | Their organisation | Full control: create websites, invite agents, view all conversations, manage billing/settings |
| **Manager** | Their organisation | Manage agents and conversations; cannot change org-level billing settings |
| **Agent** | Assigned websites only | Handle incoming chats on assigned websites; cannot access admin settings |

## Inviting a new agent

1. Go to **Settings → Users** and click **Invite agent**.
2. Enter their name and email address.
3. Select their role.
4. Click **Send invite**.

The new user receives an email with an OTP verification link. They must verify their email before they can log in.

## Assigning agents to websites

New agents have no website access by default. To route chats to them:

1. Go to **Settings → Websites → [your website] → Agents**.
2. Find the agent and enable the toggle.

## Enabling / disabling users

Owners and System Managers can disable user accounts. A disabled user cannot log in and is excluded from all routing pools. The toggle is on the user row in **Settings → Users**.

> An owner cannot disable their own account.

## Availability status

Each agent can toggle their own availability (the green/grey dot in the sidebar). 

- **Available** — agent appears online to visitors and receives chat routing
- **Away** — agent is excluded from routing; already-assigned conversations remain with them

## Agent availability and office hours

If all agents are away (or outside office hours), the widget shows the offline state and can trigger offline automations.

## Resetting passwords

- **Any user** can change their own password via **Settings → Profile → Change Password** (requires current password).
- **Owner / System Manager** can reset another user's password via the user edit panel in **Settings → Users**.
- Managers cannot reset other users' passwords — they must use the profile page themselves.
