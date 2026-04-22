# Settings UI Restructure & Agent Management

## Summary
Implemented proper nested routing for Settings page and added comprehensive agent management functionality.

## Changes Made

### 1. Frontend - Settings Layout Fix

#### Problem
- Clicking "Manage Websites" or "Profile & Availability" opened pages in full screen
- Settings sidebar disappeared when navigating to child pages
- Layout duplication causing spacing issues

#### Solution
- Restructured routing to use React Router nested routes
- Settings component now uses `<Outlet />` to render child components
- Child components (WebsitesSettings, PersonalSettings) no longer render their own layouts
- Settings sidebar remains visible while content area updates

**Files Modified:**
- `frontend/src/App.tsx` - Changed to nested routing structure
- `frontend/src/pages/Settings.tsx` - Added `<Outlet />`, renamed "Websites" to "General"
- `frontend/src/pages/WebsitesSettings.tsx` - Removed duplicate layout wrapper
- `frontend/src/pages/PersonalSettings.tsx` - Removed duplicate layout, fixed dark mode

### 2. Agent Management Feature

#### New Page: AgentsManagement.tsx
Complete CRUD interface for managing agent users:

**Features:**
- ✅ List all agents (excludes administrators)
- ✅ Create new agents with name, email, password
- ✅ Toggle agent active/inactive status
- ✅ Delete agents with confirmation modal
- ✅ Show availability status badges (Available/Unavailable)
- ✅ Show active status (green check/red X icons)
- ✅ Empty state with icon when no agents exist
- ✅ Full dark mode support

**Backend Endpoints Added:**
- `PATCH /users/{user_id}/status` - Toggle user active/inactive (admin only)
- `DELETE /users/{user_id}` - Delete user account (admin only)
  - Prevents deleting yourself
  - Prevents deleting the last admin

**Existing Endpoints Used:**
- `GET /auth/users` - List all active users (admin only)
- `POST /auth/register` - Create new user (admin only)

### 3. Settings Structure Update

**New Organization:**
```
Settings
├── General
│   ├── Manage Websites
│   └── Manage Agents (NEW)
└── Personal
    └── Profile & Availability
```

**Changed:**
- Renamed "Websites" category to "General"
- Added "Manage Agents" link under General (admin only)

### 4. Role System Clarification

**Backend Roles (Only 2):**
1. `FULL_ACCESS` (Administrator)
   - Full system access
   - Can create/manage all users
   - Can manage websites
   - Can access all features

2. `LIMITED_ACCESS` (Agent)
   - Can handle chat conversations
   - Can toggle own availability
   - Cannot access admin features

**No Manager Role** - Only Administrator and Agent roles exist in the system.

### 5. Dark Mode Improvements
- Fixed PersonalSettings alert messages (green/red alerts now support dark mode)
- Added dark mode classes to all headings and text in PersonalSettings
- AgentsManagement fully supports dark/light mode

## Testing Checklist

### Settings Navigation
- [ ] Navigate to Settings → General → Manage Websites
  - Sidebar should remain visible
  - Content area should show website management
  - Breadcrumb/title should update
  
- [ ] Navigate to Settings → General → Manage Agents
  - Sidebar should remain visible
  - Content area should show agent list
  - Only administrators can access
  
- [ ] Navigate to Settings → Personal → Profile & Availability
  - Sidebar should remain visible
  - Content area should show profile settings
  - All users can access

### Agent Management
- [ ] Create new agent
  - Fill name, email, password
  - Submit form
  - Agent should appear in list
  - Default role: limited_access
  
- [ ] Toggle agent status
  - Click toggle button
  - Icon should change (✓ → ✗ or vice versa)
  - Status should persist on page refresh
  
- [ ] Delete agent
  - Click delete button
  - Confirmation modal should appear
  - Confirm deletion
  - Agent should be removed from list
  
- [ ] Verify admin protection
  - Administrators should NOT appear in agent list
  - Cannot delete yourself
  - Cannot delete last admin

### Dark Mode
- [ ] Toggle between light/dark mode in Settings page
- [ ] Verify all sections render correctly in both modes
- [ ] Check AgentsManagement page in both modes
- [ ] Verify PersonalSettings alerts in both modes

## API Endpoints Reference

### Agent Management
```
GET    /auth/users              - List all users (admin only)
POST   /auth/register           - Create new user (admin only)
PATCH  /users/{id}/status       - Toggle user active status (admin only)
DELETE /users/{id}              - Delete user (admin only)
```

### User Self-Service
```
GET    /auth/me                 - Get current user
GET    /users/me/availability   - Get own availability
POST   /users/me/availability   - Toggle own availability
```

## Code Structure

### Settings Component Hierarchy
```
<Settings>                      // Sidebar + layout container
  <Outlet>                      // Renders child routes
    <WebsitesSettings>          // Wraps WebsiteManagement
    <AgentsManagement>          // New agent CRUD page
    <PersonalSettings>          // Profile & availability
```

### Routing Structure
```typescript
<Route path="/dashboard" element={<DashboardLayout />}>
  <Route path="settings" element={<Settings />}>
    <Route index element={<Navigate to="websites" replace />} />
    <Route path="websites" element={<WebsitesSettings />} />
    <Route path="agents" element={<AgentsManagement />} />
    <Route path="personal" element={<PersonalSettings />} />
  </Route>
</Route>
```

## Notes

1. **Role Filtering**: AgentsManagement filters users by `role !== 'full_access'` to show only agents
2. **Soft Delete**: DELETE endpoint sets `is_active = false` rather than hard delete
3. **Status vs Availability**:
   - `is_active`: Account enabled/disabled (admin control)
   - `is_available`: Ready to take chats (user control)
4. **Admin Safety**: Cannot delete yourself or the last admin account
5. **Dark Mode**: All components support dark mode via Tailwind `dark:` classes

## Future Enhancements

1. Add agent editing (update name, email, password)
2. Add bulk operations (enable/disable multiple agents)
3. Add agent activity logs
4. Add agent performance metrics
5. Add password reset functionality
6. Add role-based permissions UI (if Manager role is added later)
