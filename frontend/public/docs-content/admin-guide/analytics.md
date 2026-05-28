# Analytics Guide

The Analytics dashboard gives you a clear view of conversation volume, agent performance, customer satisfaction, and tag usage. Filter the data by date range and — if you manage multiple websites — by a specific property.

---

## KPI Cards

Three summary cards at the top of the page always show both **Agent** and **Bot** splits side by side:

| Card | Agent row | Bot row |
| :--- | :--- | :--- |
| **New Conversations** | Visitor-initiated conversations handled by agents | Visitor-initiated conversations handled entirely by bot |
| **Resolved Conversations** | Conversations closed by an agent | Conversations auto-resolved by bot |
| **Avg. First Response** | Average seconds from first visitor message to first agent reply | "Automated — n/a" (no human response time) |

Each row shows the current period value, a percentage change badge, and the previous period value it compares against.

> **Counting rule:** A conversation is counted only once a visitor sends a real message (`last_visitor_message_at` is set). WebSocket connect events and welcome messages that received no reply are excluded.

---

## Tabs

### Conversations

Daily chart showing new and resolved conversations over the selected period.

| Metric | Description |
| :--- | :--- |
| **New Conversations** | Grouped by the date of the visitor's first real message. |
| **Resolved Conversations** | Grouped by the date the conversation was actually resolved (`resolved_at`), not by creation date. |
| **Avg. First Response Time** | Average time from first visitor message to first agent reply. |

### Agents

Per-agent breakdown for the period:

| Column | Description |
| :--- | :--- |
| **Conversations Handled** | Conversations assigned to this agent. Bot-only conversations are excluded. |
| **Messages Sent** | Total messages sent by the agent. |
| **Avg. First Response Time** | Time from assignment to first reply, averaged across their conversations. |

### Tags

Tag usage counts attributed to the conversation's creation date (not when the tag was applied).

### Ratings

CSAT breakdown — Good 😊 / Neutral 😐 / Bad 😞 — with total counts and percentages.

### Teams

Per-team conversation and resolution counts for the period.

### Bot

Dedicated tab for bot-handled flows:

| Card | Description |
| :--- | :--- |
| **Bot Conversations** | Visitor-initiated conversations that went through a bot flow. |
| **Auto-Resolved** | Conversations the bot closed without any agent involvement. |
| **Auto-Resolve Rate** | Percentage of bot conversations that were auto-resolved. |

Two daily charts show bot new conversations (purple) and bot auto-resolved conversations (light purple).

---

## Filters

| Filter | Effect |
| :--- | :--- |
| **Date range** | All metrics are scoped to the selected start/end dates (inclusive). |
| **Website** | Scope to a single website. Default: all websites you have access to. |
| **Agent** | Filter Conversations and Agents tabs to one agent. |
| **Team** | Filter to a specific team. |

---

## Exporting Data

### Download Report

Click **Download Report** to export a conversation-level summary as an Excel `.xlsx` file. The first row is the column header, the second row is a description of each column.

Only conversations where the visitor sent at least one message are included (ghost sessions excluded).

| Column | Description |
| :--- | :--- |
| Conversation ID | Short unique identifier (e.g. `A1B2C3`) |
| Status | `open` or `resolved` |
| Website | Website name |
| Team | Routed team name |
| Visitor Name | Name provided by visitor |
| Visitor Email | Email on file |
| Visitor Phone | Phone number on file |
| Contact Filled | `Yes` if any contact field was provided |
| Session ID | Browser session UUID |
| Visitor IP | IP address at time of chat |
| Device | Device type |
| Browser | Browser name/version |
| Agents | Assigned agent + all agents who sent a message (comma-separated, deduplicated) |
| Started At | Timestamp of visitor's first real message |
| Resolved At | Timestamp the conversation was resolved |
| Chat Duration (mins) | Minutes from first interaction to resolution (blank if unresolved) |
| First Response Time (s) | Seconds from first interaction to first agent reply |
| Visitor Messages | Number of messages sent by the visitor |
| Agent Messages | Number of messages sent by agents |
| Rating | `Good`, `Neutral`, `Bad`, or blank |
| Rating Feedback | Free-text comment left by the visitor with their rating |
| Closed By | How the conversation ended (`agent`, `visitor`, `inactivity`, `bot`) |
| Tags | Comma-separated tags |
| Lead Source | `utm_source` query parameter from the page URL, or `direct` |
| Referrer | HTTP referrer URL of the visitor's first page view |
| Page URL | URL of the visitor's first page view |

### Download Transcripts

Click **Download Transcripts** to export a message-by-message log as a flat Excel tab. Every message is one row; conversation metadata is repeated on each row for easy filtering.

| Column | Description |
| :--- | :--- |
| Conversation Short ID | |
| Status | `open` or `resolved` |
| Website | |
| Team | |
| Visitor Name | |
| Visitor Email | |
| Visitor Phone | |
| Session ID | |
| Visitor IP | |
| Device | |
| Browser | |
| Agent | |
| Rating | Good / Neutral / Bad |
| Tags | Comma-separated |
| Closed By | |
| Conv Started At | Conversation creation timestamp |
| Timestamp | When this specific message was sent |
| Sender | `visitor`, `agent`, `bot`, or `system` |
| Message Type | `text`, `image`, `file`, etc. |
| Message | Full message content |

> **Tip:** In Excel, freeze the header row and use column filters to slice by website, agent, rating, or any other dimension.
