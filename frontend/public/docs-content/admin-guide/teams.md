# Teams

Teams let you organise agents into groups and route individual conversations to specific groups within a website.

## When to use teams

- You have a large agent pool and want to route chats by department (e.g. Sales, Support, Billing)
- Different websites need different agent groups

## Creating a team

1. Go to **Settings → Teams** and click **New team**.
2. Enter a team name.
3. Add members by searching for agents in your organisation.

## Assigning a conversation to a team

From inside any open conversation, an agent or manager can assign it to a team using the **Team** selector in the conversation detail panel. Once assigned:

- Only members of that team see the conversation in their inbox.
- Only team members receive push notifications and unread counts for it.
- Agents on the same website but not in that team become spectators — they can open the conversation but won't be notified.

## Unassigned conversations (no team)

If a conversation has **no team assigned**, it is visible to **all agents on that website** regardless of their team membership. Everyone gets push notifications and unread counts so any agent can claim it.

This is intentional — unassigned conversations are in an open pickup state until a team or agent is assigned.

## Agents with no team membership

An agent assigned to a website but not a member of any team on that website is **unrestricted**:

- They see all conversations on that website (both team-assigned and unassigned).
- They receive push notifications and unread counts only for **unassigned** conversations.
- For team-assigned conversations they are spectators — live updates appear but no push or unread badge.

## Websites with no teams configured

If a website has **no teams at all**, all agents assigned to that website are in the full routing pool — they all receive push notifications and unread counts for every conversation.

## Notification routing summary

| Conversation state | Who gets push + unread |
|---|---|
| No team assigned | All agents on the website |
| Assigned to Team A, no agent joined | Team A members only |
| Assigned to Team A, Agent X joined | Agent X only |
| Website has no teams | All agents on the website |

Owners and Managers always receive notifications for all conversations across their organisation's websites, regardless of team configuration.
