# 🔒 Milestone 3 Backend - Quick Reference

## Files Modified

### Core Changes
1. ✅ `backend/app/api/deps.py` - Added `require_admin()` and `require_agent()`
2. ✅ `backend/app/models/website.py` - Added `ai_enabled` Boolean field
3. ✅ `backend/alembic/versions/ab993fa219ef_*.py` - New migration for ai_enabled

### API Protection Updates
4. ✅ `backend/app/api/websites.py` - Admin protection + AI settings endpoint
5. ✅ `backend/app/api/agent_assignments.py` - Admin protection + User model migration
6. ✅ `backend/app/api/knowledge.py` - Admin protection on write operations

### Already Complete
7. ✅ `backend/app/api/users.py` - Availability toggle (already existed)

---

## Database Migration

**Run before server restart:**
```bash
cd /home/frappe/Applications/ai-chatassist/backend
python3 -m alembic upgrade head
```

**Expected output:**
```
INFO  [alembic.runtime.migration] Running upgrade 46963d838181 -> ab993fa219ef, milestone_3_add_website_ai_enabled_flag
```

---

## Quick Test Commands

### Verify Migration Applied
```bash
# Check if column exists
psql -d <your_db_name> -c "\\d websites"
# Look for: ai_enabled | boolean | not null | false
```

### Test API Protection (requires tokens)
```bash
# Test as Admin (should work)
curl -X POST http://localhost:8000/websites \
  -H "Authorization: Bearer <ADMIN_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"name":"Test Site","domain":"test.local"}'

# Test as Agent (should fail with 403)
curl -X POST http://localhost:8000/websites \
  -H "Authorization: Bearer <AGENT_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"name":"Test Site","domain":"test.local"}'
```

---

## Breaking Changes

### API Response Changes
- `GET /websites` now includes `ai_enabled: bool` field
- `GET /agent-assignments/website/{id}/agents` now returns User data with `name` and `role` fields

### Authentication Requirements
All these endpoints now require admin role:
- `POST /websites`
- `PUT /websites/{id}`
- `DELETE /websites/{id}`
- `PUT /websites/{id}/widget-config`
- `PATCH /websites/{id}/ai-settings` (NEW)
- `POST /agent-assignments/assign`
- `DELETE /agent-assignments/unassign`
- `GET /agent-assignments/website/{id}/agents`
- `POST /knowledge/sources`
- `POST /knowledge/documents/upload`
- `POST /knowledge/documents/text`
- `POST /knowledge/documents/{id}/index`
- `DELETE /knowledge/documents/{id}`
- `POST /knowledge/documents/crawl`

---

## Frontend Impact

### Required Frontend Updates (Milestone 3 Part 2)
1. Update API types to include `ai_enabled` in Website interface
2. Handle 403 errors gracefully (show proper error messages)
3. Hide admin menu items for LIMITED_ACCESS users
4. Update agent assignment UI to show User.name and User.role

### No Immediate Action Required
- Backend enforces permissions even if UI shows buttons
- Existing agent operations continue to work
- Chat functionality unchanged

---

## Rollback Instructions

If issues occur:

```bash
# Rollback database migration
cd /home/frappe/Applications/ai-chatassist/backend
python3 -m alembic downgrade -1

# Revert code changes
cd /home/frappe/Applications/ai-chatassist
git diff HEAD -- backend/
git checkout -- backend/app/api/deps.py
git checkout -- backend/app/models/website.py
git checkout -- backend/app/api/websites.py
git checkout -- backend/app/api/agent_assignments.py
git checkout -- backend/app/api/knowledge.py
rm backend/alembic/versions/ab993fa219ef_*.py
```

---

## Common Issues & Solutions

### Issue: Migration fails with "column already exists"
**Solution:** Column was added manually. Either:
1. Drop the column and re-run migration
2. Mark migration as applied: `alembic stamp ab993fa219ef`

### Issue: 403 errors on all endpoints
**Solution:** Check JWT token has correct role. Admin operations require `role: "full_access"`

### Issue: Frontend can't create websites anymore
**Solution:** This is intentional! Only admins can create websites. Update UI to hide button for agents.

---

## Verification Checklist

Before marking complete:
- [ ] Migration runs without errors
- [ ] `websites` table has `ai_enabled` column
- [ ] Admin can create/update websites
- [ ] Agent gets 403 when trying to create websites
- [ ] Agent can view websites (GET)
- [ ] Agent can toggle own availability
- [ ] Agent can join chats
- [ ] No errors in server logs during normal operation
- [ ] AI still generates responses (unchanged behavior)

---

## Next Steps

Ready to proceed with **Milestone 3 Part 2: Dashboard UI**

Changes needed:
1. Hide admin menus for LIMITED_ACCESS users
2. Split Settings into Websites vs Personal
3. Add availability toggle button
4. Update route guards
5. Update TypeScript interfaces

**Backend is ready and protected** ✅
