# Managing Teams

Teams allow you to organize your agent pool into specialized groups to ensure that incoming inquiries are routed to the most qualified personnel.

---

## Team Configuration

### Creating a Team
Follow these steps to create a new team:
- **Step 1**: Navigate to **Settings > Teams** and select **New Team**.
- **Step 2**: Enter a descriptive **Name** for the group (e.g., Sales or Support).
- **Step 3**: Search for and select **Members** from your organization to add to the team.

### Assignment Logic
An agent can be a member of multiple teams across different websites, allowing for flexible organizational structures.

---

## Conversation Routing and Ownership

Assigning a conversation to a team ensures that only the relevant specialists are notified of the visitor's needs.

### Team Assignment Workflow
Agents or Managers can assign any active conversation to a team using the **Team Selector** in the conversation detail panel.

### Operational Impact of Team Assignment
Once a conversation is assigned to a specific team:
- **Visibility**: Only members of the assigned team will see the conversation in their primary inbox view.
- **Notifications**: System-level alerts and unread counts are exclusively dispatched to team members.
- **Spectating**: Agents assigned to the same website who are NOT in the assigned team transition to a "spectator" role. They can still view the chat history but will not be actively notified of updates.

---

## Handling Unassigned Conversations

Conversations that have not yet been assigned to a specific team are considered to be in an "Open Pickup" state.

- **Global Visibility**: Unassigned conversations are visible to all agents assigned to the website.
- **Unified Alerts**: All agents on the website receive notifications for unassigned chats to ensure rapid initial response times.
- **Claiming Logic**: Once any agent or manager assigns a team or joins the chat, the conversation is moved out of the open pickup state.

---

## Complex Routing Scenarios

### Agents Without Team Membership
If an agent is assigned to a website but does not belong to any specific team on that property, they are granted **Unrestricted Visibility**:
- They can monitor all conversations on the website.
- They only receive proactive alerts for **Unassigned** conversations.

### Websites Without Teams
For organizations that do not require specialized routing, websites can operate without any teams. In this configuration, all agents assigned to the website act as a single, unified group, receiving alerts for every conversation.

---

## Notification Routing Matrix

| Conversation State | Notification Recipients |
| :--- | :--- |
| **No Team Assigned** | All agents assigned to the website. |
| **Team Assigned (Unclaimed)** | Only members of the assigned team. |
| **Agent Joined** | Only the assigned agent. |
| **No Teams Configured** | All agents assigned to the website. |

> **Administrative Oversight**: Owners and Managers are exempt from standard routing rules and will receive notifications for all organizational activity to ensure full operational visibility.
