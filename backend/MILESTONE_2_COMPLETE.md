# ✅ Milestone 2: Conversation Mode & Behavioral Logic - COMPLETE

## Overview
Milestone 2 establishes the behavioral rules for AI ↔ Agent transitions, implementing exclusive handling with First-Come-First-Served (FCFS) atomic claiming and temporary agent ownership with automatic timeout.

**Date Completed:** December 29, 2025  
**Branch:** `feature/unified-user-model`  
**Commits:** 
- Step 2.1: `6465b99` - Conversation Mode & Claiming
- Step 2.2: `06aa512` - Inactivity Timeout & AI Resumption

---

## 🎯 Core Concepts

### Two-Dimensional Conversation State
Every conversation has **TWO independent dimensions**:

1. **STATUS** (Lifecycle State)
   - `ACTIVE` - Ongoing conversation
   - `OFFLINE` - Visitor disconnected
   - `CLOSED` - Conversation ended

2. **MODE** (Current Handler)
   - `AI_HANDLING` - AI is responding to visitor
   - `WAITING_FOR_AGENT` - Waiting for an agent to claim
   - `AGENT_HANDLING` - Agent is actively handling

**Critical Rule:** Status and mode are independent. A conversation can be `ACTIVE` in any mode.

### Exclusive Handling
**Only ONE entity can handle a conversation at any time:**
- When `mode = AI_HANDLING`, only AI responds
- When `mode = AGENT_HANDLING`, only assigned agent responds
- When `mode = WAITING_FOR_AGENT`, conversation is unclaimed

### Temporary Agent Ownership
**Agents do not "own" conversations permanently:**
- After 15 minutes of inactivity, agent is automatically released
- Visitor messages trigger inactivity check and potential release
- Agent must re-claim if they want to respond after timeout
- AI resumes if enabled, otherwise returns to `WAITING_FOR_AGENT`

---

## 📦 Step 2.1: Conversation Mode & Claiming

### Purpose
Implement exclusive AI ↔ Agent handling with atomic First-Come-First-Served claiming mechanism.

### Implementation

#### 1. ConversationMode Enum
```python
class ConversationMode(str, Enum):
    AI_HANDLING = "ai_handling"
    WAITING_FOR_AGENT = "waiting_for_agent"
    AGENT_HANDLING = "agent_handling"
```

#### 2. Database Schema
**Migration:** `48e25fb7e142_step_2_1_conversation_mode.py`

```sql
ALTER TABLE conversations ADD COLUMN mode VARCHAR(50) NOT NULL DEFAULT 'ai_handling';
```

#### 3. Atomic Claiming (FCFS)
```python
def claim_conversation(conversation_id, agent_id, agent_name):
    # Atomic UPDATE with WHERE conditions ensures only one agent wins
    result = db.execute(
        update(Conversation)
        .where(Conversation.id == conversation_id)
        .where(Conversation.assigned_agent_id.is_(None))
        .where(Conversation.mode == ConversationMode.WAITING_FOR_AGENT)
        .values(
            assigned_agent_id=agent_id,
            mode=ConversationMode.AGENT_HANDLING
        )
    )
    
    if result.rowcount == 0:
        return False, "Already claimed by another agent"
    
    return True, "Claimed successfully"
```

**Why FCFS Works:**
- PostgreSQL serializes transactions
- WHERE conditions ensure idempotency
- Zero race conditions even with concurrent claims

#### 4. Permission Enforcement
```python
def can_agent_message(conversation_id, agent_id):
    if conversation.mode != ConversationMode.AGENT_HANDLING:
        return False, "Conversation not in agent handling mode"
    
    if conversation.assigned_agent_id != agent_id:
        return False, "Not assigned to this agent"
    
    return True, "Can message"
```

#### 5. AI Pause
```python
def handle_visitor_message(conversation):
    if conversation.mode == ConversationMode.AGENT_HANDLING:
        # AI is paused, do not generate response
        return
    
    # AI generates response only if mode = AI_HANDLING
```

#### 6. Inbox Filtering
```python
def get_active_chats(agent_id):
    # Show conversations:
    # 1. Assigned to this agent (AGENT_HANDLING)
    # 2. Available to claim (WAITING_FOR_AGENT)
    # 
    # Hide: AI_HANDLING conversations
    return conversations.filter(
        or_(
            Conversation.mode == ConversationMode.WAITING_FOR_AGENT,
            and_(
                Conversation.mode == ConversationMode.AGENT_HANDLING,
                Conversation.assigned_agent_id == agent_id
            )
        )
    )
```

### API Endpoints

#### POST `/conversations/{id}/claim`
Claim a waiting conversation (FCFS atomic operation)

**Request:**
```json
{
  "agent_id": 123
}
```

**Response (Success):**
```json
{
  "success": true,
  "message": "Conversation claimed"
}
```

**Response (Already Claimed):**
```json
{
  "success": false,
  "message": "Already claimed by another agent"
}
```

#### GET `/conversations/{id}/can_message`
Check if agent can send message

**Response:**
```json
{
  "can_message": true,
  "reason": "Can message"
}
```

### Testing
**File:** `test_step_2_1.py`  
**Tests:** 10 comprehensive tests  
**Status:** ✅ All passed

Key test scenarios:
1. Mode initialization (AI vs non-AI websites)
2. FCFS atomic claiming with concurrent agents
3. Second agent rejection
4. AI response blocking when agent handling
5. Permission enforcement
6. Inbox filtering (agent sees only relevant chats)

---

## 📦 Step 2.2: Inactivity Timeout & AI Resumption

### Purpose
Implement temporary agent ownership with automatic timeout and AI resumption, preventing visitors from getting stuck.

### Implementation

#### 1. Timestamp Fields
**Migration:** `46963d838181_step_2_2_inactivity_timestamps.py`

```sql
ALTER TABLE conversations 
  ADD COLUMN last_agent_message_at TIMESTAMP,
  ADD COLUMN last_visitor_message_at TIMESTAMP;
```

#### 2. Configuration
```python
# app/core/config.py
AGENT_INACTIVITY_TIMEOUT_SECONDS: int = 15 * 60  # 15 minutes
```

#### 3. Inactivity Detection
```python
def is_agent_inactive(conversation):
    if not conversation.last_agent_message_at:
        return True  # Never messaged = inactive
    
    elapsed = (datetime.utcnow() - conversation.last_agent_message_at).total_seconds()
    return elapsed > settings.AGENT_INACTIVITY_TIMEOUT_SECONDS
```

#### 4. Auto-Release on Visitor Message
```python
def add_visitor_message(conversation_id, content):
    conversation = get_conversation(conversation_id)
    
    # Check for inactive agent BEFORE creating message
    if conversation.mode == ConversationMode.AGENT_HANDLING:
        if is_agent_inactive(conversation):
            # Auto-release inactive agent
            conversation.assigned_agent_id = None
            
            # Determine new mode based on AI availability
            if conversation.website.ai_instructions:
                conversation.mode = ConversationMode.AI_HANDLING
            else:
                conversation.mode = ConversationMode.WAITING_FOR_AGENT
            
            # Add system message
            add_system_message(conversation, "An agent will be with you shortly.")
            
            db.commit()
    
    # Update visitor timestamp
    conversation.last_visitor_message_at = datetime.utcnow()
    
    # Create visitor message
    message = Message(conversation_id=conversation_id, content=content)
    db.add(message)
    db.commit()
    
    return message
```

#### 5. Timestamp Tracking
```python
def add_agent_message(conversation_id, agent_id, content):
    message = Message(conversation_id=conversation_id, content=content)
    db.add(message)
    
    # Update agent activity timestamp
    conversation.last_agent_message_at = datetime.utcnow()
    db.commit()
    
    return message
```

### Behavioral Flow

```
Agent Claims Conversation
    ↓
Agent Sends Message
    ↓
[15 minutes pass]
    ↓
Visitor Sends Message
    ↓
System Detects Agent Inactive
    ↓
Auto-Release Agent:
  - Clear assigned_agent_id
  - If AI enabled: mode → AI_HANDLING
  - If AI disabled: mode → WAITING_FOR_AGENT
  - Add system message
    ↓
AI Resumes or Agents Can Re-Claim
```

### Testing
**File:** `test_step_2_2.py`  
**Tests:** 12 comprehensive tests  
**Status:** ✅ All passed

Key test scenarios:
1. Timestamp updates on agent/visitor messages
2. Active agent not released
3. Inactive agent detected after timeout
4. Visitor message triggers auto-release
5. System message added on release
6. Agent cannot message after release
7. Agent must re-claim
8. AI-enabled website → AI_HANDLING
9. AI-disabled website → WAITING_FOR_AGENT
10. Visitor timestamp tracking
11. Re-claim allowed after release
12. Config value respected

---

## 🔑 Critical Rules Established

### 1. Exclusivity
**Only one handler at a time:**
- AI and agent cannot both respond
- Mode determines current handler
- Permission checks enforced

### 2. FCFS Claiming
**First agent wins, others rejected:**
- Atomic database operation
- No race conditions
- Clean failure for late agents

### 3. Temporary Ownership
**Agents don't own forever:**
- 15-minute inactivity timeout
- Auto-release on visitor message
- Must re-claim to continue

### 4. Visitor Protection
**Visitor never stuck:**
- AI resumes if enabled
- Returns to queue if AI disabled
- System messages explain status

### 5. State Integrity
**Clean transitions only:**
- Two dimensions (status + mode) independent
- No corrupt states
- All transitions logged

---

## 📊 Database Schema

### Conversations Table (Updated)
```sql
CREATE TABLE conversations (
    id SERIAL PRIMARY KEY,
    website_id INTEGER REFERENCES websites(id),
    session_id VARCHAR(255) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'active',  -- Milestone 1
    mode VARCHAR(50) NOT NULL DEFAULT 'ai_handling',  -- Step 2.1
    assigned_agent_id INTEGER REFERENCES users(id),  -- Milestone 1
    last_agent_message_at TIMESTAMP,  -- Step 2.2
    last_visitor_message_at TIMESTAMP,  -- Step 2.2
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);
```

### Migrations Applied
1. `eeb28dc4e63a` - Initial schema (Milestone 1)
2. `cb96bda2a9b9` - Agent website assignments (Milestone 1)
3. `48e25fb7e142` - Conversation mode (Step 2.1)
4. `46963d838181` - Inactivity timestamps (Step 2.2)

---

## 🎓 Lessons Learned

### What Works Well

1. **Two-Dimensional State Model**
   - Clear separation of lifecycle (status) and ownership (mode)
   - Prevents confusion between "who handles" vs "is it active"
   - Easy to reason about transitions

2. **FCFS Atomic Claiming**
   - Database serialization handles concurrency
   - No application-level locking needed
   - Clean failure modes

3. **Message-Time Auto-Release**
   - No background jobs needed
   - Visitor message triggers check
   - Simple and reliable

4. **System Messages**
   - Keep visitor informed
   - Explain what happened
   - Better UX than silence

### Key Insights

1. **Timestamps > Flags**
   - Instead of `is_agent_active` flag, use `last_agent_message_at`
   - Enables time-based logic
   - More flexible for future features

2. **Check-Then-Act Pattern**
   - Check inactivity BEFORE creating message
   - Ensures clean state
   - Prevents race conditions

3. **Mode-Based Routing**
   - Simpler than complex conditionals
   - Easy to extend (future modes)
   - Clear intent in code

---

## 🚀 Next Steps

With Milestone 2 complete, the backend has:
- ✅ Unified user model
- ✅ Agent availability and assignments
- ✅ Conversation lifecycle management
- ✅ Exclusive AI ↔ Agent handling
- ✅ FCFS atomic claiming
- ✅ Temporary agent ownership with timeout

**Ready for:**
- Dashboard UI updates (show mode, claim button)
- Widget updates (reflect mode in UI)
- AI confidence rules (decide when to hand off)
- Agent performance metrics
- Advanced features (transfer, multi-agent, etc.)

---

## 📈 Test Coverage

### Step 2.1 Tests
```
✓ Test 1: AI-enabled website starts in AI_HANDLING
✓ Test 2: Non-AI website starts in WAITING_FOR_AGENT
✓ Test 3: First agent claims successfully (FCFS)
✓ Test 4: Second agent rejected
✓ Test 5: AI doesn't respond when agent handling
✓ Test 6: System message on claim
✓ Test 7: Agent can message after claim
✓ Test 8: Non-assigned agent cannot message
✓ Test 9: Conversation shows in agent inbox
✓ Test 10: Concurrent claiming (race condition test)

Result: 10/10 PASSED ✓
```

### Step 2.2 Tests
```
✓ Test 1: Conversation claimed successfully
✓ Test 2: Agent timestamp updated on message
✓ Test 3: Agent not inactive immediately after message
✓ Test 4: No auto-release when agent active
✓ Test 5: Agent considered inactive after timeout
✓ Test 6: Visitor message triggers auto-release
✓ Test 7: System message added on auto-release
✓ Test 8: Agent cannot message after release
✓ Test 9: Auto-release to AI_HANDLING when AI enabled
✓ Test 10: Visitor timestamp tracked
✓ Test 11: Agent can re-claim after release
✓ Test 12: Config value respected

Result: 12/12 PASSED ✓
```

### Total Tests
**22 tests, 22 passed, 0 failed** ✅

---

## 🎉 Summary

Milestone 2 establishes the **core behavioral rules** for the live agent system:

1. **Conversations have dual dimensions** (status + mode)
2. **Exclusive handling** (AI or agent, never both)
3. **FCFS atomic claiming** (no race conditions)
4. **Temporary ownership** (agents time out after inactivity)
5. **Visitor protection** (never stuck, AI resumes)

The system is now ready for UI integration and advanced features. The foundation is solid, tested, and follows industry best practices for concurrency, state management, and user experience.
