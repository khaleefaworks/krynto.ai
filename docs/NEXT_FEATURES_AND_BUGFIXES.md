# Next Features & Bug Fixes (Post-Automations Refactor)

This document tracks the next wave of changes after the Automations & Message Taxonomy work.

## Scope / Requirements

### 1) Agent availability should not block joining a conversation
**Problem**: An agent can currently join a conversation even if they are marked “not available”, and/or availability doesn’t automatically become available when the agent starts their first chat.

**Expected behavior**:
- An agent marked as **not available** should **not** be able to join a conversation.
- If an agent has not explicitly enabled availability yet, once they start their **first chat** (join/claim), availability should flip to **available = true**.

**Acceptance**:
- Joining is rejected or blocked when agent availability is off.
- First successful join/claim sets availability to true.

### 2) Chat page panels default collapsed
**Problem**: Filter column and right meta panel are collapsible and persist state in local storage, but the initial/default should be collapsed.

**Expected behavior**:
- On first load (no local storage value), both panels start collapsed.
- Existing local storage values still win.

**Acceptance**:
- Fresh browser profile loads chat page with both panels collapsed.

### 3) Conversation list time should reflect last message time
**Problem**: Conversation list shows a relative time (e.g. 32m, 1h, 10d) but should reflect the time of the **last message**, like WhatsApp.

**Expected behavior**:
- The timestamp uses the latest message timestamp (visitor or agent), not conversation created time.

**Acceptance**:
- New agent/visitor messages update the list time.

### 4) Desktop sidebar: move Settings icon to bottom
**Problem**: Global left sidebar has the logo at top and icons; settings icon should move to the bottom area between theme icon and profile.

**Expected behavior**:
- Desktop only: Settings icon appears between theme toggle icon and profile icon.

**Acceptance**:
- Desktop layout updated; mobile is unchanged for now.

## Notes
- Mobile sidebar optimizations are explicitly out of scope for this iteration.
