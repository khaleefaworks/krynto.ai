# API Reference

AI ChatAssist exposes a REST API (FastAPI) and WebSocket endpoints. This reference is for developers integrating with or extending the platform.

## Base URL

```
https://api.yourdomain.com
```

All REST endpoints return JSON. Authentication uses `Bearer` tokens in the `Authorization` header.

## Authentication

### Login

```http
POST /auth/login
Content-Type: application/json

{
  "email": "agent@example.com",
  "password": "yourpassword"
}
```

Response:
```json
{
  "access_token": "eyJ...",
  "token_type": "bearer",
  "user": { ... }
}
```

Use the `access_token` as `Authorization: Bearer <token>` on all subsequent requests.

Tokens are valid for **24 hours**. Tokens are invalidated immediately when you change your password or a System Manager resets the platform.

---

## Core endpoints

### Health

```http
GET /health
```

### Conversations

```http
GET  /chats/active          # List active conversations (your scope)
GET  /chats/{short_id}      # Get a single conversation
POST /chats/{short_id}/join # Join / claim a conversation
POST /chats/{short_id}/resolve  # Resolve (close) a conversation
POST /chats/{short_id}/read     # Mark messages as read
GET  /chats/{short_id}/messages # Fetch message history
```

### Users

```http
GET    /users/me            # Current user profile
PUT    /users/me            # Update profile
PUT    /users/me/password   # Change own password (requires current_password)
GET    /users               # List users in org (manager+)
POST   /auth/register       # Invite a new user
PUT    /users/{id}          # Update user (owner+)
PUT    /users/{id}/password # Reset user password (owner+, not self)
DELETE /users/{id}          # Deactivate user (owner+)
```

### Websites

```http
GET    /websites            # List websites in org
POST   /websites            # Create website
GET    /websites/{id}       # Get website detail
PUT    /websites/{id}       # Update website
DELETE /websites/{id}       # Delete website
GET    /websites/{id}/agents          # List assigned agents
POST   /websites/{id}/agents          # Assign agent
DELETE /websites/{id}/agents/{user_id} # Unassign agent
```

### Automations

```http
GET    /automations?website_id={id}   # List automations
POST   /automations                    # Create automation
PUT    /automations/{id}              # Update automation
DELETE /automations/{id}              # Delete automation
```

### Teams

```http
GET  /teams_overview        # Teams with members and website assignments
POST /teams                 # Create team
PUT  /teams/{id}            # Update team
POST /teams/{id}/members    # Add member
DELETE /teams/{id}/members/{user_id}  # Remove member
```

### Analytics

```http
GET /analytics?website_id={id}&from={date}&to={date}
```

---

## WebSocket endpoints

### Visitor chat

```
WS /ws/chat/{website_id}?session_id=UUID&widget_key=KEY
```

Events sent by visitor:
```json
{ "type": "message", "message": { "content": "Hello" } }
{ "type": "typing_start" }
{ "type": "typing_stop" }
```

Events received by visitor:
```json
{ "type": "message", "message": { ... } }
{ "type": "agent_typing" }
{ "type": "conversation_assigned", "agent": { ... } }
{ "type": "conversation_closed" }
{ "type": "rating_request" }
```

### Agent socket

```
WS /ws/agent/0
Authorization: Bearer <token>   (via query param ?token=)
```

Events sent by agent:
```json
{ "type": "message", "payload": { "conversation_id": 1, "content": "Hi!" } }
{ "type": "typing_start", "payload": { "conversation_id": 1 } }
{ "type": "heartbeat" }
```

Events received by agent:
```json
{ "type": "visitor_message", "payload": { ... } }
{ "type": "agent_message", "payload": { ... } }
{ "type": "conversation_new", "payload": { ... } }
{ "type": "conversation_assigned", "payload": { ... } }
{ "type": "conversation_closed", "payload": { ... } }
{ "type": "agent_typing", "payload": { ... } }
{ "type": "visitor_typing", "payload": { ... } }
{ "type": "system_message", "payload": { ... } }
```

### Presence

```
WS /ws/presence/{website_id}?widget_key=KEY
```

Used by the widget to check if any agents are online. Receives a simple `online` / `offline` status update.

---

## Widget public endpoints (no auth)

```http
GET  /widget/loader/{website_id}?widget_key=KEY   # Fetch widget config
POST /widget/upload                                 # Upload attachment
POST /widget/ratings                               # Submit CSAT rating
```
