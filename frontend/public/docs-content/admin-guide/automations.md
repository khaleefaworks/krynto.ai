# Automations and Workflows

Automations are rule-based flows that let AI ChatAssist interact with visitors proactively — greeting new visitors, routing inquiries to the right team, sending waiting messages, and more — all without any manual intervention.

---

## Visual Flow Canvas

Each automation is built and edited in a **node-graph canvas**. You drag, connect, and configure nodes visually without writing any code. The canvas lives at:

**Settings → Websites → [Your Website] → Automations → [Open / New flow]**

---

## Anatomy of an Automation

Every automation has four core concepts:

| Concept | Purpose |
| :--- | :--- |
| **Trigger** | The system event that starts the flow. |
| **Nodes** | Individual steps — send a message, assign a team, emit a system event, etc. |
| **Edges** | Arrows connecting nodes to define execution order. |
| **Repeat / Cooldown** | Controls how often the flow can fire for the same visitor. |

---

## Trigger Reference

| Trigger | When It Fires |
| :--- | :--- |
| **Conversation Created** | When a visitor opens the widget and a conversation is created. Fires proactively on connect — the visitor does not need to type first. |
| **New Visitor** | First-ever visit by this browser session (no previous conversation). |
| **Returning Visitor** | Visitor has a prior conversation history. |
| **Visitor Connected** | Every time the visitor socket connects (page load or reconnect). |
| **Visitor Disconnected** | Visitor closed the tab or lost connection. |
| **Visitor Reconnected** | Visitor returns to a page after a disconnect. |
| **No Agent Assigned (After Delay)** | Fires after a configurable number of seconds if no agent has joined the conversation. |
| **Website Offline — First Message** | Visitor sends a message while the website is in offline mode. |
| **Agent Joined** | An agent opens and joins the conversation. |

---

## Node Types

| Node | What It Does |
| :--- | :--- |
| **Send Bot Message** | Delivers a text message from the "bot" sender in the chat. |
| **Bot Prompt (Buttons)** | Sends a message with selectable reply buttons. Each button can optionally route the conversation to a specific team. |
| **Assign Team** | Assigns the conversation to a chosen team. |
| **Tag with Agent Name** | Applies a tag containing the joining agent's name to the conversation. |
| **Emit System Event** | Records a system event in the conversation timeline (visible to agents, not visitors). |

---

## Template Library

The **Library** tab on the Automations screen offers pre-built flows you can activate with a single click:

| Template | Trigger | Purpose |
| :--- | :--- | :--- |
| **New visitor welcome** | New Visitor | Greets first-time visitors immediately. |
| **Returning visitor welcome** | Returning Visitor | Personalised welcome-back message. |
| **Visitor connected event** | Visitor Connected | Logs a system event when the visitor socket connects. |
| **Visitor dropped event** | Visitor Disconnected | Logs when the visitor leaves the page. |
| **Visitor reconnected** | Visitor Reconnected | Logs when the visitor returns. |
| **Waiting message** | No Agent Assigned (30 s) | Reassures visitors that an agent is on the way. |
| **Offline prompt** | Website Offline — First Message | Informs visitors the team is unavailable and collects their query. |
| **Agent joined** | Agent Joined | Tags the conversation with the joining agent's name. |
| **Team routing chatbot** | Conversation Created | Shows a button menu at conversation start so visitors self-select the right team. |

---

## Team Routing Chatbot

The **Team Routing Chatbot** template uses the **Bot Prompt (Buttons)** node to present the visitor with department options. For each button you can set:

- **Label** — the text shown on the button in the widget.
- **Reply** — the message the bot sends after the visitor clicks.
- **Team** — the team to assign the conversation to on click (optional).

This lets visitors self-route to Sales, Support, Billing, or any other team without an agent having to read and redirect the conversation manually.

> The flow fires proactively when the visitor connects — they do not need to type anything first.

---

## Repeat and Cooldown

The **Trigger** node's **Repeat** setting controls re-firing behaviour:

| Repeat Mode | Behaviour |
| :--- | :--- |
| **Once** | Fires once per session; never again for the same visitor. |
| **Cooldown** | Fires at most once per cooldown window (configurable in seconds). |
| **Always** | Fires every time the trigger event occurs, no throttle. |

---

## Ordering and Priority

When multiple automations share the same trigger, drag them into the desired order in the list. The engine evaluates automations top-to-bottom and stops at the first one that fires successfully.

---

## Enabling / Disabling

Use the status toggle on each automation card to pause a flow without deleting it. Disabled automations are skipped during evaluation.

---

## System Attribution

Messages delivered by automations appear as **Bot** messages in the chat (distinguished by a bot badge). System event nodes produce **System** messages visible only to agents in the dashboard.
