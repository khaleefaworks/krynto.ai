# Automations

Automations are rule-based messages sent by the system automatically when specific events occur. They let you greet visitors, collect information, or guide conversations without any agent involvement.

## How automations work

Each automation has:
- A **trigger** — the event that fires it
- **Conditions** (optional) — filters that must be true for it to fire
- **Actions** — what happens (currently: send a message with an optional delay)
- A **cooldown** — minimum time between fires for the same visitor

## Triggers

| Trigger | When it fires |
|---------|--------------|
| `visitor_message_received` | The visitor sends their first (or any) message |
| `conversation_assigned` | An agent joins/is assigned to the conversation |
| `agent_join` | An agent opens the conversation thread |
| `visitor_connected` | The visitor's widget connects to the website |

## Example: welcome message

A typical setup:
- **Trigger:** `visitor_connected`
- **Delay:** 2 seconds
- **Message:** "Hi there! 👋 How can we help you today?"
- **Cooldown:** 1 hour (so returning visitors within an hour don't see it again)

## Example: offline message

When no agents are online, an automation can fire immediately on `visitor_connected`:
- **Message:** "We're away right now. Leave your details and we'll get back to you."

## Managing automations

1. Go to **Settings → Websites → [your website] → Automations**.
2. Choose from templates or create a custom automation.
3. Enable/disable without deleting using the toggle.

## Order of execution

Multiple automations can be active for the same trigger. They fire in the order they are listed. Use drag-to-reorder to control priority.

## System messages in the chat

Automation messages appear in the visitor's widget as system messages (not attributed to a specific agent). In the agent dashboard they appear as SYSTEM sender messages.
