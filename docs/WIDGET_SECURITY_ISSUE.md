# Widget Security Issue Analysis

## Problem Statement

The chat widget currently has a **critical security flaw** that allows conversations to be created **BEFORE** the system is properly initialized:

### Current Broken Flow:

1. **System Not Initialized:**
   - No admin account exists
   - No websites created
   - Database is empty

2. **Widget Still Works:**
   - Demo page has hardcoded `data-website-id="1"`
   - Widget initializes and connects to WebSocket
   - User can send messages
   - Conversations are created in database

3. **Security Issue:**
   - After onboarding, admin sees conversations from BEFORE initialization
   - Anyone can create conversations without proper website setup
   - No validation that website exists before widget loads

## Current Architecture

### Widget (widget/chat-widget.js)
```javascript
// Reads from script tag
<script 
  src="chat-widget.js" 
  data-website-id="1"
  data-ws-url="ws://localhost:8000"
  data-api-url="http://localhost:8000">
</script>

// Widget auto-initializes on page load
// No validation if website exists or is active
```

### Backend (backend/app/api/ws_chat.py)
```python
@router.websocket("/ws/chat/{website_id}/{session_id}")
async def chat_ws(...):
    # NOW checks if website exists
    website = db.query(Website).filter_by(id=website_id).first()
    if not website:
        # Sends error and closes connection
        await websocket.close(code=1008, reason="Website not found")
        return
```

**Good:** Backend now validates website exists before creating ChatService
**But:** Widget still loads and tries to connect

### Widget Config Endpoint (backend/app/api/websites.py)
```python
@router.get("/{website_id}/widget-config")
def get_widget_config(website_id: int, ...):
    website = db.query(Website).filter_by(id=website_id).first()
    if not website:
        raise HTTPException(status_code=404, detail="Website not found")
    # Returns config
```

**Good:** Returns 404 if website doesn't exist
**But:** Widget ignores this error and uses defaults

## How Other Platforms Handle This

### Smartsupp Approach:
1. Account setup required first
2. Website must be created in dashboard
3. Only then, user gets embed code:
   ```html
   <script>
     var _smartsupp = _smartsupp || {};
     _smartsupp.key = 'a1b2c3d4e5f6g7h8i9j0';
   </script>
   <script src="https://www.smartsupp.com/bundle.js"></script>
   ```
4. Widget validates the key with backend
5. If invalid/expired key → widget doesn't load

### Intercom Approach:
1. Workspace creation required
2. App ID generated
3. Embed code includes app_id:
   ```javascript
   window.intercomSettings = {
     api_base: "https://api-iam.intercom.io",
     app_id: "abc123"
   };
   ```
4. Widget validates app_id on initialization
5. Invalid app_id → widget shows error

## Proposed Solution

### Option 1: Website Key Authentication (Recommended)
Generate a unique key for each website that must be embedded:

```html
<!-- Website-specific embed code -->
<script 
  src="https://yourdomain.com/widget/chat-widget.js" 
  data-website-key="wk_1a2b3c4d5e6f7g8h9i0j"
  data-api-url="https://yourdomain.com">
</script>
```

**Backend Changes:**
1. Add `widget_key` column to `Website` model
2. Generate unique key on website creation
3. Validate key on WebSocket connection
4. Widget config endpoint requires valid key

**Widget Changes:**
1. Read `data-website-key` instead of `data-website-id`
2. Send key to backend for validation
3. Backend returns website_id after validating key
4. Show error if key is invalid

### Option 2: Simple Website ID Validation (Quick Fix)
Keep current approach but validate properly:

**Widget Changes:**
1. Check if widget config endpoint returns 404
2. If 404 → Don't load widget, show nothing
3. If config loaded → Proceed with initialization
4. If WebSocket returns "Website not found" → Hide widget

**Backend Changes:**
1. Already validates website exists in WebSocket ✅
2. Already returns 404 in config endpoint ✅

### Option 3: Hybrid Approach
Combine both approaches:
1. Use website keys for production (secure)
2. Allow website_id for demo/development (convenient)
3. Environment variable to control mode

## Security Concerns

### Current Issues:
1. ❌ Anyone can embed widget with any website_id
2. ❌ No way to revoke widget access
3. ❌ Demo page creates real conversations before setup
4. ❌ Widget doesn't respect 404 from config endpoint

### After Fix (Option 1):
1. ✅ Website key required for widget to work
2. ✅ Can regenerate key to revoke access
3. ✅ Demo page won't work until website created
4. ✅ Invalid keys prevent widget loading

### After Fix (Option 2):
1. ⚠️ Still allows any website_id to be tried
2. ❌ No revocation mechanism
3. ✅ Demo page won't create conversations
4. ✅ Widget respects validation errors

## Recommended Implementation Plan

### Phase 1: Quick Fix (Option 2) - Today
1. Fix widget to respect 404 from config endpoint
2. Hide widget if website doesn't exist
3. Update demo.html with proper instructions
4. Document that website must be created first

### Phase 2: Security Enhancement (Option 1) - Next Sprint
1. Add `widget_key` column to Website model
2. Generate keys on website creation
3. Add key validation to all widget endpoints
4. Update widget to use keys
5. Add key regeneration in admin UI
6. Update documentation

## Demo Page Fix

### Current demo.html Issues:
```html
<!-- Hardcoded website_id=1 -->
<script 
  src="chat-widget.js" 
  data-website-id="1"
  ...>
</script>
```

### Fixed demo.html:
```html
<!-- Instructions to set up properly -->
<div class="warning">
  ⚠️ Before testing the widget:
  1. Complete onboarding at /login
  2. Create a website in Dashboard → Settings → Websites
  3. Copy the widget embed code from the website settings
  4. Paste it here
</div>

<!-- Widget will only work after website is created -->
<script 
  src="chat-widget.js" 
  data-website-id="YOUR_WEBSITE_ID"
  ...>
</script>
```

## Files to Modify

### Quick Fix (Phase 1):
1. `widget/chat-widget.js` - Validate config endpoint response
2. `widget/demo.html` - Update instructions
3. `widget/README.md` - Document setup requirements

### Security Enhancement (Phase 2):
1. `backend/app/models/website.py` - Add widget_key column
2. `backend/alembic/versions/` - New migration for widget_key
3. `backend/app/api/ws_chat.py` - Validate widget_key
4. `backend/app/api/websites.py` - Add key generation, regeneration
5. `frontend/src/pages/WebsiteManagement.tsx` - Show widget key, copy button
6. `widget/chat-widget.js` - Use widget_key instead of website_id

## Testing Checklist

### Before Fix:
- [x] Widget works without website in database ❌ BAD
- [x] Conversations created before initialization ❌ BAD
- [x] No validation on widget load ❌ BAD

### After Quick Fix:
- [ ] Widget checks config endpoint first
- [ ] Widget hides if website doesn't exist
- [ ] No conversations created without valid website
- [ ] Demo page shows setup instructions

### After Security Enhancement:
- [ ] Widget key required for embedding
- [ ] Invalid keys prevent widget loading
- [ ] Keys can be regenerated in admin UI
- [ ] Old keys become invalid after regeneration
