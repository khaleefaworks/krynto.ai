This document is for me to track the identifying bugs. I will only decide when to fix it.

1) Some tasks pending in SAAS_REFACTOR_PLAN.md

Phase 5 Audit — 3 items still pending:

#	Task	Status
3	Multi-conversation widget flow tests — rating guard and unread aggregate subtests missing (active/history separation test exists)	Partial
6	Agent resolve shows rating popup without requiring closing automation — no test	Missing
8	JWT organization_id tampering test — no test	Missing

2) Assign team dropdown in chat page not having create team button same like Tag Conversation dropdown. ✅ FIXED — Added "Manage teams" link in team picker popover (visible to admins)

3) Notification sounds on both side is not good, need to clone like smartsupp.

4) New message popup on widget's reply button icon should be same like smartsupp. Also this popup color should be same as widget theme color that defined in this page http://localhost:5173/dashboard/settings/websites/1?tab=widget

5) Widget's hover is slightly croppinmg the chat icon inside it. Try to replicate this design also same as smarstupp.

6) Widget CSS & JS need to be optimized.

7) Setup Guide in Dashboard needs to be redesigned.

8) demo page - dark/light mode should be store in local storage and apply on reload. ✅ FIXED — localStorage persistence added to demo.html

9) Dashboard side, push notification is not opening the right chat on click. ✅ FIXED — Push notification URL now uses short_id path instead of query param with numeric id

10) Push notification & inapp notification should one come for assigned teams chat. If agents including owner is not assigned to any team, then for all chats it should come but only for assigned websites.

11) Currently notification count badge is not working properly. When an agent is assigned to a website, then only he will get the chat. Also if a chat is joined by any agent, then for other agents un read cound need not to show. But always the chat list should get updated with live chats.

12) Chats page filter should be improved.

13) Resolved conversation count is not fetching by default, its happening only when clicked. ✅ FIXED — Resolved conversations now load eagerly on mount, not just when filter is clicked

14) When an agent sending a image in message, by that time if the widget is in collapsed state. The new message popup is not showing anything. Atlead some image or pdf or file is send by then like it should show. Also the close button is not clearly visible. ✅ FIXED — Widget popup now shows "📷 Sent an image" / "📎 Sent a file" fallback for attachment-only messages

15) In the textarea always a Hi message is there when I open. It is due to ai_chatassist_draft_1_2 key in local storage. I guess the functionality is not working properly. ✅ FIXED — Draft and draft attachments are now cleared from localStorage after sending a message

16) When the visitor ends chat, the rating is showing after that new conversation is starting. I guess this is not needed here. Why simply wasting a conversation. If a visitor resolved means his need is over. For better UX, after rated or skiped rating just minimize the widget. Basically next again the bot message should not trigger. So something needs to store in session storage. if the visitor closed the browser tabs and coming back even after immediately then we can start the new conversation silently and start the loop. Okey what if the visitor wants to start new conversation without closing the tabs??? Great idea, after minimized if the visitor clicks the widget, if history is enabled via website settings show the history by default andd there new conversation option should be there. What if history is disabled? then start the new conversation. Especially in this case what if the visitor sends message before the 1st bot message ? then if bot message comes it won't be nice. I think here we need to have one more automation message trigger for returning visitor within some time period. so without delay as soon as the conversation page opened before even the visitor sends message, the system bot message should trigger like welcome back. This is purely controlled from automations.

17) http://localhost:5173/dashboard/customers/visitors - visitor page conversation history and open conversation green button flows are not working. The id is wrong I guess. Also the conversation with just bot message is showing in the list, this is fine I guess. The agent can initiate the chat by clicking it right? but on clicking it is not opening any chat in chat page. just openinhg the chat page but the URL has chat id. ✅ VERIFIED — Navigation now uses short_id and matches the route pattern correctly

18) Visitor page row have came from column, that is - if direct visit. Better check all scenarios there. ✅ FIXED — Now shows "Direct" instead of "-" for null/empty came_from values

19) Need to test the contact page once.

20) In Settings -> Profile page the body doesn't have top and bottom paddding. It is declared but it's not working. ✅ FIXED — Removed vertical centering that was overriding padding; content now flows naturally with proper top/bottom padding

21) Settings -> Organization page needs to be improved same as Profile. ✅ FIXED — Page redesigned to match Profile layout: centered content with a top header bar, organization initials avatar (no upload), inline edit for organization name, a small stats overview and plan/active badge. See `frontend/src/pages/OrgSettings.tsx` for implementation details.

22) Huge issue, in Settings -> User list row, there is a toggle for disable user but for owner it should not be there. basically they should not lockdown themself. ✅ FIXED — Toggle is now always-on and disabled for owner role (same as system_manager). Self-deactivation prevented on both frontend (disabled toggle) and backend (403 guard). What will happen for other users? what if they lockdown themselves?

23) Settings -> Website -> General - Conversation History option should be in Widget settings. ✅ FIXED — Widget settings were redesigned and grouped (Appearance, Header, Chat Bubble, Notification Popup, Colors, Features). Conversation History moved into the Widget tab; live Widget and Popup previews were added; position options limited to Bottom Right/Left. See `frontend/src/pages/WebsiteWidgetTab.tsx` and `frontend/src/pages/WebsiteDetail.tsx`.

24) Settings -> Website -> Automations - this is not that user friendly. Lot of unwanted templates, now we changes relove workflow right? so few things needs to be deleted in templates itself. There should be 4 tabs, Templates Auto Messages, Chatbots, AI Agents. Same like Automessages, chatnot should have delete option. if delete it will be available in templates to add again. AI Agents feature is comming soon. Need to understand how the automessage feature is implemented and need to be improved and code optimizations.

25) If a chat is resolved or closed, agent side also the send message input should not be available. mistakenly also they should not send message to closed chats. ✅ FIXED — ChatComposer disabled on resolved chats; also fixed textarea staying locked when switching from resolved back to active conversation (editor.setEditable sync)

26) http://localhost:5173/dashboard/customers/visitors - one more bug is in the row the visitor column have chat icon if the visitor initiate chat. But now we are conversation based, when a 1st message send from visitor for the current open conversation then only it should show. Also found a bug in open conversation button and the open conv in conv section of right popover. On clicking on that taking me to chats page but if there is not 1st chat initiated, it is not opening that chat at all. just url have that new id that only have bot conversation in it. ✅ FIXED — Chat icon now checks latest open conversation only; bot-only convs open with styled warning modal; deep-link fallback fetches unknown short_ids from API; assigned conversations always appear in active list; auto-title from first visitor message removed (title only set from offline form)

27) Currently if no agents online, there is a form popup, that needs to be impoved. Forms and form fields should not be via columns. We can create a form table and each form column can be stored as objects. Will this work out? Also form should be triggered via agent chat, automations.

28) When the customer ends the chat from the widget, the Agent Dashboard displays the message: "YOU ENDED THE CHAT."

29) When a user with the role of Owner or Manager is logged in, the Profile section displays only "Agent."

30) In the Profile section, the "Change Password" option is available for users with the Owner role, which should not be the case.

31) In widget, the position is not based on the website settings. It is always showing in the bottom right corner.

32) In User list, the manager should not get update password option, only owner should have that.However all other users can do it via profile page.

33) When a new user added in the organization, the email is not getting sent to them. Need to check the email configuration and flow once. After OTP verification only they should be able to login.

34) Failed to fetch error, when new user is getting added in the organization. Need to check the API once.

Features:

1) Administrator's superadmin portal needs to be improved. light/dark mode, list view for users and orgs. If possible, same like frappe the superadmin portal is actually should have all possible lists. But if it is adding more load, then leave it.