# Agents and Roles

AI ChatAssist uses a role-based access control system to manage team permissions and website access.

---

## Organizational Roles

Roles define the scope of authority and the specific capabilities available to a user.

| Role | Operational Scope | Core Capabilities |
| :--- | :--- | :--- |
| **Owner** | Organization-wide | Complete administrative control, including billing, organizational settings, and website management. |
| **Manager** | Organization-wide | Oversight of agents and conversation data. Can manage team assignments but lacks access to billing and global security settings. |
| **Agent** | Website-specific | Front-line support. Access is restricted to conversations and data for websites specifically assigned to them. |
| **System Manager** | Platform-wide | A specialized role for platform maintenance, with access to all organizations and system-level statistics. |

---

## User Onboarding

### Inviting New Team Members
Follow these steps to add a new agent to your team:
- **Step 1**: Navigate to **Settings > Users** and select **Invite Agent**.
- **Step 2**: Provide the user's full name and professional email address.
- **Step 3**: Assign the appropriate **Role** based on their responsibilities.
- **Step 4**: Send the invite; an email with a verification link will be dispatched.

> [!IMPORTANT]
> **Email Verification**: For security purposes, invited users must verify their email address before they are granted access to the dashboard.

---

## Access Control & Assignments

By default, new agents are not assigned to any website. Access must be granted explicitly to ensure data privacy and accurate routing.

### Assigning Agents to Websites
1. Go to **Settings > Websites** and select the target property.
2. Navigate to the **Agents** tab.
3. Use the toggle next to the agent's name to grant or revoke access.

Once assigned, the agent will appear in the routing pool and can begin receiving notifications for that website.

---

## Presence and Availability

The **Availability Toggle** (located in the agent sidebar) controls the real-time routing logic of the platform.

### Status Definitions
- **Available**: The agent is active and eligible to receive new conversation assignments.
- **Away**: The agent is excluded from new chat routing. Any conversations already assigned to them remain in their inbox but will not trigger new alerts.

### System-Wide Offline State
If all assigned agents for a website are set to **Away**, or if the current time falls outside of the configured **Office Hours**, the website widget will automatically transition to an offline state.

---

## Security and Account Management

### Account Status
Owners and Managers can deactivate user accounts at any time. A deactivated account is immediately logged out, blocked from further access, and removed from all active routing pools.

### Password Management
- **Self-Service**: Users can update their own passwords through the **Settings > Profile** panel.
- **Administrative Reset**: Owners can trigger a password reset for any user within their organization through the **User Management** panel.

> [!NOTE]
> **Owner Protection**: To prevent accidental lockouts, Owners cannot deactivate their own accounts. To transfer ownership, another user must first be promoted to the Owner role.
