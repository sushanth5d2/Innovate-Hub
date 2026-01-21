# Community Enhancements Implementation Plan

## Issues Identified

### 1. **Announcements - Attachment Display Bug** 🐛
- Images not showing in announcements
- Document files not displaying
- **Root Cause**: URL paths not properly constructed for uploads

### 2. **Time Display - Timezone Issue** ⏰
- Showing wrong time (5hrs off)
- Using UTC instead of IST (Indian Standard Time)
- **Root Cause**: SQLite stores UTC, but formatDate doesn't convert to IST

### 3. **Missing Features - Announcements** 📢
- ✅ Edit announcements (Backend exists, frontend missing)
- ✅ Delete announcements (Backend exists, frontend missing)
- ❌ Reactions (Need full implementation)
- ❌ Reply/Comments (Need full implementation)

### 4. **Missing Features - Group Messages** 💬
- ❌ Edit messages
- ❌ Delete messages
- ❌ Reply/Quote messages
- ❌ Forward messages
- ❌ Message reactions
- ❌ Polls in group chat

## Implementation Steps

### Phase 1: Critical Fixes (Immediate)
1. Fix attachment display in announcements ✅
2. Fix timezone to IST ✅  
3. Wire up edit/delete announcement buttons ✅

### Phase 2: Reactions & Comments (Next)
4. Add announcement reactions system
5. Add announcement comments/replies

### Phase 3: Group Message Features  
6. Edit/delete group messages
7. Reply/quote in group messages
8. Forward messages
9. Message reactions
10. Group chat polls

## Technical Details

### IST Timezone Fix
- IST = UTC + 5:30
- Update `formatDate()` and `formatTimestamp()` in app.js
- Convert UTC timestamps to IST before display

### Attachment Display Fix
- Normalize URLs in announcement rendering
- Handle both absolute and relative paths
- Support all file types: images, videos, PDFs, docs

### Database Schema Additions Needed
```sql
-- Announcement reactions
CREATE TABLE announcement_reactions (
  id INTEGER PRIMARY KEY,
  announcement_id INTEGER,
  user_id INTEGER,
  reaction_type TEXT, -- 'like', 'love', 'care', 'wow', 'sad', 'angry'
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Announcement comments
CREATE TABLE announcement_comments (
  id INTEGER PRIMARY KEY,
  announcement_id INTEGER,
  user_id INTEGER,
  content TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Group message edit history
ALTER TABLE community_group_posts ADD COLUMN edited_at DATETIME;
ALTER TABLE community_group_posts ADD COLUMN is_edited BOOLEAN DEFAULT 0;

-- Group message reactions
CREATE TABLE group_message_reactions (
  id INTEGER PRIMARY KEY,
  message_id INTEGER,
  user_id INTEGER,
  reaction_type TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

## Files to Modify

1. `/public/js/app.js` - Timezone functions
2. `/public/community.html` - Announcement rendering & group chat
3. `/routes/communities.js` - New API endpoints
4. `/config/database.js` - Schema migrations
5. `/server.js` - Socket events for real-time updates

