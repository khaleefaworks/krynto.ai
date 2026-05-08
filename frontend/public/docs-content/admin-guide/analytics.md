# Analytics Guide

The Analytics dashboard gives you a clear view of conversation volume, agent performance, customer satisfaction, and tag usage. Filter the data by date range and — if you manage multiple websites — by a specific property.

---

## 1. Conversations

| Metric | Description |
| :--- | :--- |
| **New Conversations** | Total conversations created in the selected period. |
| **Resolved Conversations** | Total conversations marked Resolved during the period. |
| **Replied Conversations** | Conversations that received at least one human-agent reply. |
| **Avg. First Response Time** | Average time from conversation creation to the first agent reply. Displayed as `Xs`, `Xm Ys`, or `Xh Ym`. The daily chart uses the **median** to dampen the effect of outliers. |

---

## 2. Agent Performance

The per-agent table breaks down activity for each team member:

| Column | Description |
| :--- | :--- |
| **Conversations Handled** | Conversations assigned to this agent during the period. |
| **Messages Sent** | Total messages sent by the agent. |
| **Avg. First Response Time** | Time from assignment to first reply, averaged across their conversations. |

---

## 3. Tag Usage

The **Tag Statistics** table shows how often each tag was applied to conversations in the selected window. Use this to spot the most common topics your visitors raise.

---

## 4. Ratings (Customer Satisfaction)

If CSAT ratings are enabled, this section shows the breakdown of visitor feedback collected after conversations are resolved:

| Rating | Meaning |
| :--- | :--- |
| **Good (😊)** | Positive experience (+1) |
| **Neutral (😐)** | Neutral experience (0) |
| **Bad (😞)** | Negative experience (−1) |

Both total counts and percentage distributions are displayed.

---

## 5. Exporting Data

### Download Report

Click **Download Report** to export a summary of all conversations as an Excel `.xlsx` file. Each row is one conversation with the following columns:

| Column | Description |
| :--- | :--- |
| Conversation ID | Internal numeric ID |
| Status | `open` / `resolved` / `closed` |
| Website | Website name |
| Team | Assigned team name (if any) |
| Visitor Name | Name provided by visitor or agent |
| Visitor Email | Email on file |
| Visitor Phone | Phone number on file |
| Session ID | Browser session UUID |
| Visitor IP | IP address at time of chat |
| Device | Operating system / device info |
| Browser | Browser name and version |
| Agent | Assigned agent's name |
| Rating | `Good`, `Neutral`, `Bad`, or blank |
| Closed By | Agent who resolved the conversation |
| Page URL | URL where the chat was initiated |
| First Response Time (s) | Seconds to first agent reply |
| Total Duration (s) | Total conversation duration in seconds |
| Tags | Comma-separated tags |
| Created At | Timestamp the conversation was created |

### Download Transcripts

Click **Download Transcripts** to export the full message-by-message log as a single flat Excel tab. Every message is one row; conversation metadata columns are repeated on each row so you can filter and sort freely in Excel.

| Column | Description |
| :--- | :--- |
| Conversation ID | |
| Status | `open` / `resolved` / `closed` |
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
