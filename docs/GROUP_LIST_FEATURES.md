# Community Group List Features Implementation

## Overview
Added three new features to the community group list to enhance user experience:

1. **Unread Message Count Badge** - Shows the number of unread messages in each group
2. **Pin Chat** - Allows users to pin important groups to the top of the list
3. **Mark All as Read** - Enables users to mark all messages in a group as read

## Database Schema Changes

### New Tables

#### 1. `group_message_reads`
Tracks the last message read by each user in each group.

```sql
CREATE TABLE IF NOT EXISTS group_message_reads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  last_read_message_id INTEGER,
  last_read_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (group_id) REFERENCES community_groups(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(group_id, user_id)
)
```

#### 2. `pinned_groups`
Stores which groups are pinned by each user.

```sql
CREATE TABLE IF NOT EXISTS pinned_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  pinned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (group_id) REFERENCES community_groups(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(group_id, user_id)
)
```

## Backend API Changes

### Updated Endpoints

#### GET `/communities/:communityId/groups`
Enhanced to include:
- `unread_count` - Number of unread messages for the current user
- `is_pinned` - Whether the group is pinned by the current user
- Sorting: Pinned groups appear first, then by latest message time

### New Endpoints

#### POST `/community-groups/:groupId/pin`
Pin a group for the current user.

**Requirements:**
- User must be a member of the group

**Response:**
```json
{
  "success": true,
  "message": "Group pinned successfully"
}
```

#### DELETE `/community-groups/:groupId/pin`
Unpin a group for the current user.

**Response:**
```json
{
  "success": true,
  "message": "Group unpinned successfully"
}
```

#### POST `/community-groups/:groupId/mark-read`
Mark all messages in a group as read for the current user.

**Requirements:**
- User must be a member of the group

**Response:**
```json
{
  "success": true,
  "message": "All messages marked as read"
}
```

## Frontend Changes

### Group List UI Enhancements

#### 1. Unread Count Badge
- Displays as a blue circular badge next to the group name
- Shows count up to 99, then displays "99+"
- Only visible when there are unread messages
- Automatically updates when messages are read

**Styling:**
```css
background: #0095f6;
color: white;
border-radius: 50%;
min-width: 20px;
height: 20px;
```

#### 2. Pin Icon
- Shows a 📌 emoji next to the group name if pinned
- Pinned groups appear at the top of the list
- Persists across sessions

#### 3. Context Menu
Accessible via the three-dot button (⋮) on each group item.

**Options:**
- **📌 Pin chat / Unpin chat** - Toggle pin status
- **✓ Mark all as read** - Mark all messages as read (disabled if no unread messages)

**Context Menu Features:**
- Positioned below the trigger button
- Dismisses when clicking outside
- Visual feedback on hover
- Disabled state for unavailable options

### Automatic Read Tracking

Messages are automatically marked as read when:
1. User opens a group with unread messages
2. User sends a message in the group
3. User explicitly marks all as read via context menu

## User Experience Flow

### Viewing Unread Messages
1. User sees blue badge with unread count on groups with new messages
2. Badge shows exact count (1-99) or "99+" for more
3. Clicking the group opens it and marks messages as read
4. Badge disappears automatically

### Pinning Groups
1. Click the three-dot menu (⋮) next to a group
2. Select "📌 Pin chat"
3. Group moves to the top of the list
4. Pin icon (📌) appears next to the group name
5. To unpin, select "📌 Unpin chat" from the menu

### Marking as Read
1. Click the three-dot menu (⋮) next to a group
2. Select "✓ Mark all as read"
3. Unread count badge disappears immediately
4. Option is disabled (grayed out) if no unread messages

## Technical Implementation Details

### Read Status Tracking
- Uses `community_group_posts.id` as message identifiers
- Stores `last_read_message_id` per user per group
- Unread count calculated as posts with ID > `last_read_message_id`
- Excludes user's own messages from unread count

### Pinning Logic
- Pinned status is stored per-user (not global)
- Groups ordered by: `is_pinned DESC, latest_message_time DESC, created_at DESC`
- Multiple groups can be pinned
- Pin state persists across sessions

### Performance Considerations
- Unread counts calculated in SQL query (efficient)
- Minimal additional database queries
- Indexes on foreign keys for fast lookups

## Testing

### Test Scenarios

1. **Unread Count Display**
   - Login as User A
   - Navigate to a community
   - Have User B send messages in a group
   - Verify unread count appears for User A
   - Open the group as User A
   - Verify count disappears

2. **Pin/Unpin Functionality**
   - Open context menu on a group
   - Click "Pin chat"
   - Verify group moves to top with pin icon
   - Click "Unpin chat"
   - Verify group returns to normal position

3. **Mark All as Read**
   - Join a group with unread messages
   - Open context menu
   - Click "Mark all as read"
   - Verify unread badge disappears
   - Verify option becomes disabled

4. **Cross-User Behavior**
   - Pin a group as User A
   - Login as User B
   - Verify the group is not pinned for User B
   - Same applies to read status

## Files Modified

### Backend
- `/config/database.js` - Added new tables in migrateDatabase()
- `/routes/community-groups.js` - Updated groups endpoint, added new endpoints

### Frontend
- `/public/js/community-workspace.js` - Enhanced renderGroups(), added context menu, mark as read functionality

## Future Enhancements

Potential improvements for future versions:

1. **Real-time Updates via Socket.IO**
   - Emit events when new messages arrive
   - Update unread counts without page refresh

2. **Unread Message List**
   - Jump to first unread message when opening group
   - Highlight unread messages

3. **Notification Settings**
   - Mute specific groups
   - Custom notification preferences per group

4. **Archive Groups**
   - Hide inactive groups from list
   - Access archived groups from separate view

5. **Search/Filter**
   - Search groups by name
   - Filter by pinned/unpinned
   - Sort options (alphabetical, activity, unread)

## Browser Compatibility

Tested and working on:
- Chrome 90+
- Firefox 88+
- Safari 14+
- Edge 90+

## Accessibility

- Context menu accessible via keyboard
- Clear visual indicators for pinned groups
- High contrast unread badges
- Screen reader friendly labels

## Known Limitations

1. Unread count requires page refresh when another user sends messages (can be resolved with Socket.IO integration)
2. Maximum displayed unread count is 99+
3. Context menu positioning may need adjustment on mobile devices in landscape mode

## Conclusion

These features significantly improve group management and message tracking in the community workspace, providing users with better visibility and control over their group communications.
