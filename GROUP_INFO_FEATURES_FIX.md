# Community Group Info Panel - Admin Features Fix

## Problem
User reported that several admin-only features were not visible in the community group info panel (right sidebar):
- ❌ Exit group
- ❌ Delete group
- ❌ Request approvals (Approval members)
- ❌ Blocked members
- ❌ Add members feature

## Root Cause
The issue was in how the system determined if a user is an admin:
1. The API endpoint `/community-groups/:groupId` was only returning `is_member` but not the user's `role`
2. The JavaScript was only checking `group.creator_id === currentUser.id` but not checking if the user has the 'admin' role
3. This meant that group members who were promoted to admin couldn't see admin features

## Changes Made

### 1. Backend API Fix (`routes/community-groups.js`)
**File:** `/workspaces/Innovate-Hub/routes/community-groups.js`

Added `user_role` to the group details query:

```javascript
// Before
const query = `
  SELECT 
    cg.*,
    u.username as creator_username,
    (SELECT COUNT(*) FROM community_group_members WHERE group_id = cg.id) as member_count,
    (SELECT COUNT(*) FROM community_group_members WHERE group_id = cg.id AND user_id = ?) as is_member
  FROM community_groups cg
  JOIN users u ON cg.creator_id = u.id
  WHERE cg.id = ?
`;
db.get(query, [userId, groupId], ...);

// After
const query = `
  SELECT 
    cg.*,
    u.username as creator_username,
    (SELECT COUNT(*) FROM community_group_members WHERE group_id = cg.id) as member_count,
    (SELECT COUNT(*) FROM community_group_members WHERE group_id = cg.id AND user_id = ?) as is_member,
    (SELECT role FROM community_group_members WHERE group_id = cg.id AND user_id = ?) as user_role
  FROM community_groups cg
  JOIN users u ON cg.creator_id = u.id
  WHERE cg.id = ?
`;
db.get(query, [userId, userId, groupId], ...);
```

### 2. Frontend Admin Detection Fix (`public/js/group-main.js`)
**File:** `/workspaces/Innovate-Hub/public/js/group-main.js`

Updated the admin check to also consider the `user_role`:

```javascript
// Before
const isAdmin = group.creator_id === currentUser.id;

// After
const isAdmin = group.creator_id === currentUser.id || group.user_role === 'admin';
```

## Features Now Properly Displayed

### Always Visible (All Members)
✅ **View members** - Shows all group members with their roles
✅ **Add members** - Opens modal to invite new members
✅ **Exit group** - Leave the group (with confirmation)

### Admin-Only Features (Visible when user is admin)
✅ **Request approvals** - Shows pending join requests (for private groups)
   - Approve or reject join requests
   - Shows count badge when there are pending requests
   
✅ **Blocked members** - Shows list of blocked users
   - Unblock members
   - Shows count when there are blocked users
   
✅ **Delete group** - Permanently delete the group
   - Shows in red color
   - Requires double confirmation
   - Deletes all messages, files, and data

✅ **Edit Profile Button** - Edit group settings (name, description, privacy)
✅ **Settings Button** - Additional group settings

## Button Visibility Logic

```javascript
// In group-main.js loadGroupData() function
const isAdmin = group.creator_id === currentUser.id || group.user_role === 'admin';

if (isAdmin) {
  // Show all admin buttons
  requestApprovalsBtn.style.display = 'block';
  blockedMembersBtn.style.display = 'block';
  deleteGroupBtn.style.display = 'flex';
  sidebarSettingsBtn.style.display = 'flex';
  sidebarEditBtn.style.display = 'inline-block';
  
  // Load admin-specific data
  loadPendingRequestsCount();
  loadBlockedMembersCount();
}
```

## Testing Instructions

1. **Test as Group Creator:**
   - Create a new group
   - Check right sidebar - all admin features should be visible
   - Test each feature:
     - View members
     - Add members
     - Request approvals (if group is private)
     - Blocked members
     - Exit group
     - Delete group

2. **Test as Promoted Admin:**
   - Have group creator promote another member to admin
   - Log in as that member
   - All admin features should now be visible
   - Verify admin can approve/reject requests
   - Verify admin can block/unblock members
   - Verify admin can delete group

3. **Test as Regular Member:**
   - Join a group as regular member
   - Only these should be visible:
     - View members
     - Add members
     - Exit group
   - Admin features should be hidden:
     - Request approvals ❌
     - Blocked members ❌
     - Delete group ❌

4. **Test as Non-Member:**
   - Try to access group you're not a member of
   - Should see "Join Group" button instead

## Database Schema Reference

The fix relies on the `community_group_members` table:
```sql
CREATE TABLE community_group_members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  role TEXT DEFAULT 'member',  -- 'admin' or 'member'
  joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (group_id) REFERENCES community_groups(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(group_id, user_id)
);
```

## API Endpoints Used

- `GET /api/community-groups/:groupId` - Get group details (now includes user_role)
- `GET /api/community-groups/:groupId/requests` - Get pending join requests
- `GET /api/community-groups/:groupId/blocked` - Get blocked members
- `DELETE /api/community-groups/:groupId` - Delete group
- `POST /api/community-groups/:groupId/leave` - Leave group
- `PUT /api/community-groups/:groupId/requests/:userId` - Approve/reject join request
- `DELETE /api/community-groups/:groupId/blocked/:userId` - Unblock member

## Files Modified

1. `/workspaces/Innovate-Hub/routes/community-groups.js` (Line ~163)
2. `/workspaces/Innovate-Hub/public/js/group-main.js` (Line ~172)

## Status
✅ **COMPLETE** - All features are now properly visible to admins

## Notes
- The fix ensures backward compatibility - group creators are always admins
- Multiple admins can now manage the group
- Regular members only see member-level features
- Exit group button is visible to all members (not just admins)
