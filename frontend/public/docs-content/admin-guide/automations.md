# Automations and Workflows

Automations are rule-based actions that enable AI ChatAssist to interact with visitors proactively based on specific triggers and conditions.

---

## Anatomy of an Automation

Every automation is built from four core components:

- **Trigger**: The specific system event that initiates the automation.
- **Conditions**: Optional filters that refine when the automation should fire (e.g., only during office hours).
- **Actions**: The system response, such as delivering a message after a specified delay.
- **Cooldown**: A safety mechanism that prevents the same automation from firing multiple times for the same visitor within a set timeframe.

---

## Trigger Reference

The system monitors several key events to drive automated workflows:

| Trigger Event | Activation Point |
| :--- | :--- |
| **Visitor Connected** | Activated as soon as the chat widget successfully loads on the visitor's page. |
| **Message Received** | Fired when a visitor sends their first message in a new session. |
| **Conversation Assigned** | Triggered when a specific agent or team is assigned to the conversation. |
| **Agent Joined** | Activated when an agent actively opens the conversation thread. |

---

## Standard Use Cases

### Proactive Welcome Greetings
Set a **Visitor Connected** trigger with a 2-second delay and a 1-hour cooldown. This creates a welcoming environment for new visitors without being intrusive for frequent returners.

### Offline Support Acknowledgement
During non-office hours, use a **Visitor Connected** trigger to immediately inform the user that the team is away and provide a timeline for a response.

---

## Management and Orchestration

### Creating and Priority
Follow these steps to manage your automations:
- **Step 1**: Navigate to **Settings > Websites > [Target Website] > Automations**.
- **Step 2**: Utilize pre-built templates or design a custom workflow from scratch.
- **Step 3**: Reorder automations to control their execution priority if they share the same trigger.

### Toggling Status
Automations can be temporarily paused using the status toggle. This allows you to disable seasonal or experimental workflows without deleting their configuration.

---

## System Attribution

Messages sent via automation are rendered as **System Messages** in both the visitor's widget and the agent dashboard. This clearly distinguishes between automated responses and human agent interactions, ensuring a transparent experience for the user.

> **Avoid Collision**: When setting up multiple automations for the same trigger, ensure their messages do not conflict. Use the **Delay** feature to space out automated interactions for a more natural conversational flow.
