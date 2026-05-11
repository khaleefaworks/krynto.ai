This document is for me to track the identifying bugs. I will only decide when to fix it.

1) Some tasks pending in SAAS_REFACTOR_PLAN.md ✅ DONE

Phase 5 Audit — 3 items still pending:

#	Task	Status
3	Multi-conversation widget flow tests — rating guard and unread aggregate subtests missing (active/history separation test exists)	Partial
6	Agent resolve shows rating popup without requiring closing automation — no test	Missing
8	JWT organization_id tampering test — no test	Missing

2) Assign team dropdown in chat page not having create team button same like Tag Conversation dropdown. ✅ FIXED — Added "Manage teams" link in team picker popover (visible to admins)

3) Notification sounds on both side is not good, need to clone like smartsupp. ✅ FIXED — Full notification sound overhaul:
- Dashboard: new Notifications page under Settings → Personal (Bell icon in sidebar). Push notification toggle moved here. Three configurable sound dropdowns (New chat / New message / New visitor on website) with live preview. 12 sound options + silent. Preferences stored in DB (`user.notification_preferences`) and synced to localStorage on login — works across devices/browsers.
- Dashboard sounds: single global 1500ms gate prevents stacking; only `visitor_message` triggers sound (not `conversation_unread`) — fixes double-sound bug.
- "New visitor on website" sound plays only when agent is on the Customers → Visitors tab (component-mounted gate).
- Widget side: two per-website sound dropdowns in Website → Widget tab (sound when collapsed / sound when open). Only blackberry2.mp3 and notification.mp3 offered. Preview button on each. Config served from backend loader as `notificationSoundCollapsed` / `notificationSoundOpened`.
- Widget sound timing fixed: collapsed sound fires together with popup (after 1200ms typing dots), not immediately. Open-widget sound fires immediately (visitor may be in another tab).
- Sound files served from backend at `/sounds/*` (mounts `frontend/public/sounds/`), so widget URL `apiUrl/sounds/file.mp3` works in production without knowing the frontend URL.
- In-app toasts removed entirely. Push notification scoped by org + website assignment + team membership.

4) New message popup on widget's reply button icon should be same like smartsupp. Also this popup color should be same as widget theme color that defined in this page http://localhost:5173/dashboard/settings/websites/1?tab=widget ✅ FIXED

5) Widget's hover is slightly croppinmg the chat icon inside it. Try to replicate this design also same as smarstupp. ✅ FIXED

6) Widget CSS & JS need to be optimized. ✅ DONE

7) Setup Guide in Dashboard needs to be redesigned.

8) demo page - dark/light mode should be store in local storage and apply on reload. ✅ FIXED — localStorage persistence added to demo.html

9) Dashboard side, push notification is not opening the right chat on click. ✅ FIXED — Push notification URL now uses short_id path instead of query param with numeric id

10) Push notification & inapp notification should one come for assigned teams chat. If agents including owner is not assigned to any team, then for all chats it should come but only for assigned websites. ✅ FIXED — Full two-level scoping implemented (website → team):
- Website level: agents only receive notifications for websites they are explicitly assigned to. OWNER/MANAGER receive all notifications for their org's websites.
- Team level (when website has teams):
  * Unassigned conversation (no team): all agents on that website get push + unread (any can claim it).
  * Conversation assigned to Team A: only Team A members get push + unread. No-team agents and Team B agents are spectators (live chat list updates, no push, no unread).
  * Once an agent joins: only the joined agent gets push + unread. All others spectate.
  * No-team agents: unrestricted visibility (see all conversations in their list) but are spectators for team-assigned chats.
- OWNER/MANAGER always get push + unread for all conversations regardless of team config.
- Active chat list (`GET /chats/active`) now includes `team_id IS NULL` conversations for team-assigned agents so unassigned chats appear in their inbox.
- Changes: `BusEvent` got `conversation_team_id` field (Redis multi-worker path); `AgentService` stores `visible_team_ids` + `is_agent_role` per socket; `broadcast_to_active_agents` enforces team + unread scoping; `_get_eligible_agent_ids_for_push` respects team assignment; docs updated (admin-guide/teams.md, agent-guide/notifications.md, agent-guide/conversations.md).

11) Currently notification count badge is not working properly. When an agent is assigned to a website, then only he will get the chat. Also if a chat is joined by any agent, then for other agents un read cound need not to show. But always the chat list should get updated with live chats. ✅ FIXED — `GET /chats/active` now zeroes out `unread_count` for spectating agents: only the assigned agent (or any agent when the conversation is unassigned/open for pickup) gets the real unread count. Spectators still see the conversation in the list and it updates live, but their badge count is not inflated by chats they don't own.

12) Chats page filter should be improved. ✅ DONE

13) Resolved conversation count is not fetching by default, its happening only when clicked. ✅ FIXED — Resolved conversations now load eagerly on mount, not just when filter is clicked

14) When an agent sending a image in message, by that time if the widget is in collapsed state. The new message popup is not showing anything. Atlead some image or pdf or file is send by then like it should show. Also the close button is not clearly visible. ✅ FIXED — Widget popup now shows "📷 Sent an image" / "📎 Sent a file" fallback for attachment-only messages

15) In the textarea always a Hi message is there when I open. It is due to ai_chatassist_draft_1_2 key in local storage. I guess the functionality is not working properly. ✅ FIXED — Draft and draft attachments are now cleared from localStorage after sending a message

16) When the visitor ends chat, the rating is showing after that new conversation is starting. I guess this is not needed here. Why simply wasting a conversation. If a visitor resolved means his need is over. For better UX, after rated or skiped rating just minimize the widget. Basically next again the bot message should not trigger. So something needs to store in session storage. if the visitor closed the browser tabs and coming back even after immediately then we can start the new conversation silently and start the loop. Okey what if the visitor wants to start new conversation without closing the tabs??? Great idea, after minimized if the visitor clicks the widget, if history is enabled via website settings show the history by default andd there new conversation option should be there. What if history is disabled? then start the new conversation. Especially in this case what if the visitor sends message before the 1st bot message ? then if bot message comes it won't be nice. I think here we need to have one more automation message trigger for returning visitor within some time period. so without delay as soon as the conversation page opened before even the visitor sends message, the system bot message should trigger like welcome back. This is purely controlled from automations. ✅ DONE — Core visitor-end flow fully implemented + returning visitor automation trigger added:
- After rating/skip → widget minimises (no new conversation started automatically)
- History disabled: shows previous chat as read-only with "Start new chat" banner, survives page reload
- History enabled: shows list view with "New Conversation" button at top + ended conv below with [Ended] badge (clickable, read-only)
- Visitor-ended conversation stays in agent's All Chats (OPEN) with "Visitor ended" badge; agent must manually resolve
- Agent dashboard reply input disabled + "Visitor ended this conversation. You can still reply or resolve it when ready." shown
- "Start new chat" properly closes the old visitor-ended conv via orchestrator (broadcasts conversation_closed to agents) before creating a fresh one
- Reload after visitor-ended + history disabled: loads thread history via conv-id WS route without firing noisy agent-side connected events
- Returning visitor automation trigger implemented (separate from visitor_connected cooldown logic)

17) http://localhost:5173/dashboard/customers/visitors - visitor page conversation history and open conversation green button flows are not working. The id is wrong I guess. Also the conversation with just bot message is showing in the list, this is fine I guess. The agent can initiate the chat by clicking it right? but on clicking it is not opening any chat in chat page. just openinhg the chat page but the URL has chat id. ✅ VERIFIED — Navigation now uses short_id and matches the route pattern correctly

18) Visitor page row have came from column, that is - if direct visit. Better check all scenarios there. ✅ FIXED — Now shows "Direct" instead of "-" for null/empty came_from values

19) Need to test the contact page once. ✅ DONE

20) In Settings -> Profile page the body doesn't have top and bottom paddding. It is declared but it's not working. ✅ FIXED — Removed vertical centering that was overriding padding; content now flows naturally with proper top/bottom padding

21) Settings -> Organization page needs to be improved same as Profile. ✅ FIXED — Page redesigned to match Profile layout: centered content with a top header bar, organization initials avatar (no upload), inline edit for organization name, a small stats overview and plan/active badge. See `frontend/src/pages/OrgSettings.tsx` for implementation details.

22) Huge issue, in Settings -> User list row, there is a toggle for disable user but for owner it should not be there. basically they should not lockdown themself. ✅ FIXED — Toggle is now always-on and disabled for owner role (same as system_manager). Self-deactivation prevented on both frontend (disabled toggle) and backend (403 guard). What will happen for other users? what if they lockdown themselves?

23) Settings -> Website -> General - Conversation History option should be in Widget settings. ✅ FIXED — Widget settings were redesigned and grouped (Appearance, Header, Chat Bubble, Notification Popup, Colors, Features). Conversation History moved into the Widget tab; live Widget and Popup previews were added; position options limited to Bottom Right/Left. See `frontend/src/pages/WebsiteWidgetTab.tsx` and `frontend/src/pages/WebsiteDetail.tsx`.

24) Settings -> Website -> Automations - this is not that user friendly. Lot of unwanted templates, now we changes relove workflow right? so few things needs to be deleted in templates itself. There should be 4 tabs, Templates Auto Messages, Chatbots, AI Agents. Same like Automessages, chatnot should have delete option. if delete it will be available in templates to add again. AI Agents feature is comming soon. Need to understand how the automessage feature is implemented and need to be improved and code optimizations. ✅ DONE

25) If a chat is resolved or closed, agent side also the send message input should not be available. mistakenly also they should not send message to closed chats. ✅ FIXED — ChatComposer disabled on resolved chats; also fixed textarea staying locked when switching from resolved back to active conversation (editor.setEditable sync)

26) http://localhost:5173/dashboard/customers/visitors - one more bug is in the row the visitor column have chat icon if the visitor initiate chat. But now we are conversation based, when a 1st message send from visitor for the current open conversation then only it should show. Also found a bug in open conversation button and the open conv in conv section of right popover. On clicking on that taking me to chats page but if there is not 1st chat initiated, it is not opening that chat at all. just url have that new id that only have bot conversation in it. ✅ FIXED — Chat icon now checks latest open conversation only; bot-only convs open with styled warning modal; deep-link fallback fetches unknown short_ids from API; assigned conversations always appear in active list; auto-title from first visitor message removed (title only set from offline form)

27) Currently if no agents online, there is a form popup, that needs to be impoved. Forms and form fields should not be via columns. We can create a form table and each form column can be stored as objects. Will this work out? Also form should be triggered via agent chat, automations. ✅ DONE

28) When the customer ends the chat from the widget, the Agent Dashboard displays the message: "YOU ENDED THE CHAT." ✅ FIXED — Backend stores "Visitor ended the chat." for agents; widget receives "You ended the chat." only for the visitor. System message content is rendered directly so agents see correct wording.

29) When a user with the role of Owner or Manager is logged in, the Profile section displays only "Agent." ✅ FIXED — PersonalSettings.tsx has full role label mapping (Owner, Manager, System Manager, Agent).

30) In the Profile section, the "Change Password" option is available for users with the Owner role, which should not be the case. ✅ RESOLVED (by design) — Change Password in Profile is correct for ALL roles including Owner; it requires the current password (OWASP security control). Admin-level "Reset Password" (no current-password check) lives only in User List and is now restricted to Owner/System Manager only (not Manager, not self).

31) In widget, the position is not based on the website settings. It is always showing in the bottom right corner. ✅ FIXED — Widget position now reads from website settings (commit e393e74)

32) In User list, the manager should not get update password option, only owner should have that.However all other users can do it via profile page. ✅ FIXED — "Reset Password" block in User List edit panel now hidden for Manager role and for own account. Backend `/users/{id}/password` endpoint returns 403 for Manager and for self-reset; self must use `/users/me/password` (requires current password).

33) When a new user added in the organization, the email is not getting sent to them. Need to check the email configuration and flow once. After OTP verification only they should be able to login. ✅ FIXED — /auth/register now sets is_email_verified=False, generates OTP, and sends a branded invite email via send_user_invite(). User must verify before first login. Re-invited (previously deleted) users also get a fresh OTP + invite email.

34) Failed to fetch error, when new user is getting added in the organization. Need to check the API once. ✅ FIXED — /auth/register had response_model=UserResponse but returned a dict of shape {message, user} causing a ResponseValidationError (500). Removed the response_model so FastAPI returns the dict directly.

35) In chat page, if there is a new chat and 2 agents are just spectating the messages but not joined the conversation yet. Both of them properly getting the new chats in the conversation. But once an agent joined the conversation, then they other agent who spectates the conversation not geeting the new message via socket. Also when an agent is already joined and having the conversation. But then another agent joined the same conversation, here the old agent is not actively listening to the socket. Actually the push notification should only send to who joined recently but anyone can spectate the live converations. ✅ FIXED (fully) — Complete spectator broadcasting implemented across all event types:
- Visitor message → assigned agent (direct) + all spectating agents (broadcast, exclude assigned) — push notification to assigned agent only
- Agent message → visitor + all spectating agents (broadcast, exclude sender); spectators see message live in thread via new agent_message handler
- Agent typing → visitor (only if sender is assigned agent; spectators' typing is never leaked to visitor) + all other agents via agent_typing broadcast; spectators see "Agent X is typing…" in status bar
- Visitor typing → assigned agent (direct) + all spectating agents (broadcast, exclude assigned); both ws_chat.py code paths (new conv + reconnect) fixed
- System messages (agent joined / takeover) → all agents via system_message broadcast; spectators see "Agent joined the chat." and date chips live in thread
- joinedRef kept in sync via conversation_assigned WS event so the takeover popup triggers correctly even after mid-session ownership changes
- confirmTakeoverAndSend now shows optimistic message immediately (same as handleSendMessage)

36) Form fields when offline — the offline form (shown when no agents are online) needs a full UX rework. Fields should be configurable per website (label, type, required), stored as JSON objects in a form_fields column, and rendered dynamically. Related to #27. Also consider triggering the form via automations instead of hardcoding it to the agent-offline state. ✅ DONE

37) Agent avatar & visitor avatar drop in chat list — the chat list sidebar should show the assigned agent's avatar and the visitor's avatar (or initials fallback) inline on each row for quick visual scanning. ✅ DONE

38) For returning visitors — don't show a "choose" option; too many scenarios. Think through all cases: history enabled/disabled, previous conv resolved vs visitor-ended vs open, visitor returning in same tab vs new tab vs new browser session. Design a seamless auto-resume or auto-start flow without forcing the visitor to pick. Related to #16. ✅ DONE

39) Reduce font size in chat page and include more details — the conversation thread / chat list feels too large; reduce font sizes, tighten spacing, and surface more useful metadata (e.g., time since last message, visitor location, assigned agent, tags) at a glance without needing to open a side panel. ✅ DONE

40) Mobile app — native or PWA mobile app for agents to handle chats on the go. Low priority. Before starting, migrate to pnpm monorepo structure first — see `docs/MONOREPO_PLAN.md`.

Features:

1) Administrator's superadmin portal needs to be improved. light/dark mode, list view for users and orgs. If possible, same like frappe the superadmin portal is actually should have all possible lists. ✅ DONE

2) Documentation milestone — README overhaul + public docs portal. Single milestone, ship together. ✅ DONE

   **Part A — README overhaul (developer + AI reference)**
   - Root `README.md`: full architecture diagram, feature list, links to sub-package READMEs, deployment overview
   - `backend/README.md`: env vars table, all API routes, services architecture, models, Alembic guide, running tests
   - `frontend/README.md`: Zustand store docs, component guide, service functions, routing, env vars
   - `mobile/README.md`: created when mobile app starts

   **Part B — Public docs portal (`/docs`)**
   - Built inside the existing frontend Vite app as a new public route — no separate app, no auth required
   - Content stored as `.md` files in a new `docs-content/` folder at repo root, version-controlled
   - Sidebar nav auto-generated from a single `nav.ts` config file (sections → pages → file paths)
   - `react-markdown` already installed — use it to render content pages
   - Separate layout from `/dashboard` (no sidebar, no auth, public access)
   - Dark mode support, breadcrumbs, per-page TOC
   - Sections: Getting Started, Agent Guide, Admin Guide, Widget Embed, API Reference
   - Future upgrade path: swap `.md` files for DB-stored Tiptap content (Tiptap also already installed) — no route or component changes needed

   **Part C — Dashboard integration**
   - "How it works" / `?` contextual link on each major feature page pointing to the relevant `/docs` page

41) Once an email address is verified, it should become read‑only and cannot be updated.
Status: ✅ DONE
Notes:
- Backend stores `is_email_verified` on `User` (backend/app/models/user.py) and verification flow exists (backend/app/api/auth.py).
- Frontend user edit panel still allows changing email in frontend/src/pages/AgentsList.tsx (edit panel sets `formEmail` and sends updates).
Recommended fix:
- Add backend guard to reject email changes when `is_email_verified` is true (return 403/400).
- Disable/hide email editing UI for verified users in frontend/src/pages/AgentsList.tsx and any other user-edit panels.
Relevant files: frontend/src/pages/AgentsList.tsx, backend/app/api/auth.py, backend/app/api/users.py

42) Widget: preserve first agent’s profile when a second owner joins.
Status: ✅ DONE — Verified working correctly. Past message bubbles bake the avatar into static DOM at render time; updateAgentAvatar() only redraws the header. Header correctly updates to the new agent; historical messages are unaffected.
Notes:
- Widget currently updates `activeAgentName` / `activeAgentAvatarUrl` on `agent_joined` and `agent` events (widget/chat-widget.js), which can overwrite the profile shown to the visitor.
Recommended fix:
- Ensure widget prefers the assigned/first agent's profile for the conversation thread, and only update to a different agent when takeover semantics require it.
Relevant files: widget/chat-widget.js

43) Mobile: Optimize Contacts and Visitors pages to avoid horizontal scrolling.
Status: ✅ DONE
Notes:
- Pages use horizontal tables with `min-w-*` causing overflow (frontend/src/pages/CustomersContacts.tsx, frontend/src/pages/CustomersVisitors.tsx).
Recommended fix:
- For small screens, show 3 columns (Name, Phone, Email), reorder columns (phone second, email third), truncate long text and avoid table min-width; consider stacked list cards or responsive column hiding.
Relevant files: frontend/src/pages/CustomersContacts.tsx, frontend/src/pages/CustomersVisitors.tsx

44) Shortcuts: support formatting (Bold, Italic, Lists) for personal and website shortcuts.
Status: ✅ DONE
Notes:
- Shortcuts editor is a plain `Textarea` storing `message` as plaintext (frontend/src/pages/PersonalShortcutsSettings.tsx, frontend/src/pages/WebsiteShortcutsTab.tsx). ChatComposer supports richer content.
Recommended fix:
- Switch shortcut editor to a Markdown-friendly input or lightweight rich editor (Tiptap or a small toolbar), persist formatted content, and ensure ChatComposer renders it correctly.
Relevant files: frontend/src/pages/PersonalShortcutsSettings.tsx, frontend/src/pages/WebsiteShortcutsTab.tsx, frontend/src/components/chat/ChatComposer.tsx

45) Allow agents to assign teams to conversations (agents cannot manage teams).
Status: ✅ DONE
Notes:
- Team picker UI is gated by `isAdmin(user)` so only Owner/Manager can open it (frontend/src/pages/ConversationsView.tsx). Backend accepts team assignment (`PUT /conversations/{id}/team`) without additional checks.
Recommended fix:
- Permit Agents to open the team picker and call the assignment API, but hide/manage the "Manage teams" link and any creation actions. Enforce any scope constraints on backend (e.g., only assign teams that belong to conversation's website).
Relevant files: frontend/src/pages/ConversationsView.tsx, frontend/src/pages/WebsiteTeamsTab.tsx, backend/app/api/conversations.py

46) Mobile UX: add slide animations for list ↔ detail transitions and visitor details panel.
Status: ✅ DONE
Notes:
- ConversationsView mobile overlays and transitions currently lack slide-in/out animation; visitor details overlay is a fixed element without `animate-in` classes.
Recommended fix:
- Add Tailwind/animation classes or CSS transitions for slide-in/out on the mobile visitor details overlay and when switching between chat list and individual chat.
Relevant files: frontend/src/pages/ConversationsView.tsx, frontend/src/components/VisitorDetailsPanel.tsx

47) Widget offline-form submissions not attached after agent rejoin/offline.
Status: ✅ DONE
Notes:
- When the widget is offline it shows the offline form and submissions normally create conversation messages.
- However, if an agent previously joined the conversation and later goes offline, the widget still shows the offline form but submitted form data is not added to the conversation input/messages (visitor data appears not to persist or attach to the conversation thread).
Recommended fix:
- Ensure the widget includes the correct `conversation_id` (or creates a new conversation) when submitting the offline form after agent join/rejoin transitions.
- Add robust handling in `widget/chat-widget.js` to detect conversation ownership changes (agent joined → agent offline) and route offline-form submissions to the proper backend API (create message or create conversation + message).
- Add backend logging and guard tests for the sequence: visitor offline form submit → agent joins → agent goes offline → visitor submits form.
Relevant files: widget/chat-widget.js, backend/app/api/conversations.py, frontend/src/pages/ConversationsView.tsx

48) Agent role getting 403 on GET /users in chat page.
Status: ✅ DONE
Notes:
- Browser console shows: `GET http://localhost:8000/users 403 (Forbidden)` when an agent logs in and views the chat page.
- The `/users` endpoint is likely restricted to admin roles only, but the chat page (or a component it loads) is calling it regardless of role.
Recommended fix:
- Guard the `GET /users` fetch in the frontend so it only fires for admin roles (OWNER/MANAGER), not AGENT.
- Or add a scoped endpoint (e.g., `GET /users/me/teammates`) that agents can call safely.
Relevant files: frontend/src/pages/ConversationsView.tsx, backend/app/api/users.py

49) Mobile: back button after entering a conversation does not return to the chat list.
Status: ✅ DONE
Notes:
- On mobile view, once a conversation is opened the browser/UI back button fails to navigate back to the conversation list.
Recommended fix:
- Ensure the mobile list↔detail transition uses proper router navigation (push) rather than local state swap, so the browser history stack allows back-navigation.
Relevant files: frontend/src/pages/ConversationsView.tsx

50) Clicking the Chats link in the global left sidebar does not clear the currently open conversation.
Status: ✅ DONE
Notes:
- On both desktop and mobile, clicking the sidebar "Chats" nav item should reset the view to the conversation list with no chat open. This was previously implemented but appears to have regressed.
Recommended fix:
- Check the sidebar nav click handler and ensure it clears the active conversation state (e.g., navigates to `/dashboard/chats` without a conversation ID, and the store/component resets `currentChat` to null).
Relevant files: frontend/src/pages/DashboardLayout.tsx, frontend/src/pages/ConversationsView.tsx, frontend/src/store/appStore.ts