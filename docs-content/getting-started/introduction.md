# Introduction

**AI ChatAssist** is a self-hosted, multi-tenant live chat platform. Visitors chat with your team via an embeddable JavaScript widget on your website; your agents respond in real time from the agent dashboard.

## What you get

- **Real-time conversations** — WebSocket-based instant messaging between visitors and agents
- **Embeddable widget** — a lightweight, customisable JavaScript snippet that drops into any website
- **Multi-website support** — manage multiple websites from a single dashboard
- **Team routing** — assign agents to specific websites or teams; chats are routed accordingly
- **Automations** — rule-based auto-messages triggered on visitor events (new chat, agent join, etc.)
- **Conversation history** — optionally let returning visitors see their past conversations
- **Push notifications** — browser push so agents never miss a chat, even when the tab is in the background
- **Analytics** — conversation volume, response times, and CSAT ratings

## Who is it for?

| Role | What they do |
|------|-------------|
| **Owner** | Signs up, creates the organisation, manages websites and agents |
| **Manager** | Manages agents and conversations across assigned websites |
| **Agent** | Handles incoming chats on assigned websites |
| **Visitor** | Chats via the widget on your website (no account needed) |
| **System Manager** | Platform-level administrator (your own superadmin) |

## How it works (high level)

```
Visitor opens your website
    ↓
Loads the chat widget (chat-widget.js)
    ↓
Connects via WebSocket to the backend
    ↓
Sends a message → backend routes it to eligible agents
    ↓
Agent receives it in the dashboard in real time
    ↓
Agent replies → visitor sees it instantly in the widget
```

## Next steps

- [Quick Start](./quick-start) — get the full stack running locally in minutes
- [Installation](./installation) — production deployment guide
