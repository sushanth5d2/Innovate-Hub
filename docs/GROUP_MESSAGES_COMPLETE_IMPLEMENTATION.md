# Group Messages Complete Implementation

## ✅ Backend Implementation Complete

### Database Schema (Added to config/database.js)
All tables created with proper foreign keys and CASCADE delete:

1. **announcement_reactions** - Reactions for community announcements
2. **announcement_comments** - Comments on community announcements
3. **group_message_reactions** - Reactions for group messages
4. **group_polls** - Polls in community groups
5. **group_poll_votes** - Votes on group polls
6. **Migration columns**: edited_at, is_edited, reply_to, is_deleted

### API Routes Added

#### Announcement Features (routes/communities.js)
- `POST /:communityId/announcements/:id/reactions` - Add reaction
- `DELETE /:communityId/announcements/:id/reactions/:type` - Remove reaction
- `GET /:communityId/announcements/:id/reactions` - Get all reactions
- `POST /:communityId/announcements/:id/comments` - Add comment
- `GET /:communityId/announcements/:id/comments` - Get comments
- `DELETE /:communityId/announcements/:id/comments/:id` - Delete comment

#### Group Message Features (routes/community-groups.js)
- `PATCH /community-groups/:groupId/posts/:postId` - Edit message
- `DELETE /community-groups/:groupId/posts/:postId` - Delete message (soft)
- `POST /community-groups/:groupId/posts/:postId/reactions` - Add reaction
- `DELETE /community-groups/:groupId/posts/:postId/reactions/:type` - Remove reaction
- `GET /community-groups/:groupId/posts/:postId/reactions` - Get reactions

#### Poll Features (routes/community-groups.js)
- `POST /community-groups/:groupId/polls` - Create poll
- `POST /community-groups/:groupId/polls/:pollId/vote` - Vote on poll
- `GET /community-groups/:groupId/polls/:pollId` - Get poll results
- `GET /community-groups/:groupId/polls` - Get all group polls

### Real-Time Socket.IO Events
All routes emit real-time events to keep all users synchronized:

- `announcement:reaction` - When reaction added/removed
- `announcement:comment` - When comment added
- `message:edited` - When message edited
- `message:deleted` - When message deleted
- `message:reaction` - When reaction added/removed
- `poll:created` - When poll created
- `poll:voted` - When someone votes

### Permission Checks
- **Members only**: All operations require group membership
- **Author only**: Edit/delete your own messages
- **Admin override**: Admins can delete any message
- **No expired polls**: Cannot vote on expired polls

## 🚧 Frontend Implementation Required

### 1. Announcement Reactions UI
**Location**: public/community.html - Announcement display section

**Components Needed**:
- Reaction button bar (👍 ❤️ 😮 😢 😡)
- Reaction count display
- Reaction picker modal
- User reaction highlighting

**Implementation**:
```javascript
function showReactionPicker(announcementId) {
  // Show modal with reaction options
  // On click, call addAnnouncementReaction()
}

async function addAnnouncementReaction(announcementId, reactionType) {
  // POST /api/communities/:id/announcements/:id/reactions
  // Update UI with new reaction counts
}

async function loadAnnouncementReactions(announcementId) {
  // GET /api/communities/:id/announcements/:id/reactions
  // Display grouped reactions with counts
}
```

### 2. Announcement Comments UI
**Location**: public/community.html - Below announcement content

**Components Needed**:
- Comments thread display
- Add comment input box
- Delete comment button (for author/admin)
- Comment count badge

**Implementation**:
```javascript
async function loadAnnouncementComments(announcementId) {
  // GET /api/communities/:id/announcements/:id/comments
  // Render comment list with author info
}

async function addAnnouncementComment(announcementId, content) {
  // POST /api/communities/:id/announcements/:id/comments
  // Append new comment to thread
}

async function deleteAnnouncementComment(announcementId, commentId) {
  // DELETE /api/communities/:id/announcements/:id/comments/:id
  // Remove comment from UI
}
```

### 3. Group Message Edit/Delete
**Location**: public/community.html - Message context menu

**Components Needed**:
- Three-dot menu button on messages
- Edit modal with pre-filled content
- Delete confirmation dialog
- "Edited" indicator on edited messages

**Implementation**:
```javascript
function showMessageMenu(postId, isOwner) {
  // Show context menu with Edit/Delete options
  // Only show Edit if user is author
  // Show Delete if user is author or admin
}

async function editGroupMessage(groupId, postId) {
  // Show modal with current content
  // On save: PATCH /api/community-groups/:groupId/posts/:postId
  // Update message in UI with "Edited" badge
}

async function deleteGroupMessage(groupId, postId) {
  // Show confirmation
  // DELETE /api/community-groups/:groupId/posts/:postId
  // Update message to show "[Message deleted]"
}
```

### 4. Group Message Reactions
**Location**: public/community.html - Message display

**Components Needed**:
- Reaction button on each message
- Reaction picker modal (👍 ❤️ 🤗 😂 😮 😢 😡)
- Reaction count bubbles below message
- User reaction highlighting

**Implementation**:
```javascript
function showMessageReactionPicker(postId) {
  // Show Instagram-style reaction picker
  // 7 reactions: like, love, care, haha, wow, sad, angry
}

async function addMessageReaction(groupId, postId, reactionType) {
  // POST /api/community-groups/:groupId/posts/:postId/reactions
  // Update reaction counts in real-time
}

async function loadMessageReactions(groupId, postId) {
  // GET /api/community-groups/:groupId/posts/:postId/reactions
  // Display grouped reactions with user list on hover
}
```

### 5. Message Reply/Quote
**Location**: public/community.html - Message context menu

**Components Needed**:
- Reply button in message menu
- Quoted message preview in compose box
- Reply indicator showing original message
- Thread visualization (optional)

**Implementation**:
```javascript
function replyToMessage(postId, authorName, content) {
  // Show reply preview in compose area
  // Store reply_to reference
  // On send: POST with reply_to field
}

function displayReplyChain(post) {
  // If post.reply_to exists, fetch and display original
  // Show indent or gray box with original content
}
```

### 6. Message Forward
**Location**: public/community.html - Message context menu

**Components Needed**:
- Forward button in message menu
- Group selector modal
- Forward confirmation
- "Forwarded message" indicator

**Implementation**:
```javascript
async function forwardMessage(postId) {
  // Show modal listing all user's groups
  // On select: POST to destination group with "Forwarded from..." prefix
  // Show success notification
}
```

### 7. Group Poll Creation
**Location**: public/community.html - Attach menu in message composer

**Components Needed**:
- Poll button in attach menu
- Poll creation modal:
  - Question input field
  - Dynamic option inputs (2-4 options)
  - Expiration time selector (1h, 24h, 7d, Never)
  - Create button

**Implementation**:
```javascript
function showPollCreator() {
  // Show modal with question and options inputs
  // Add/remove option buttons (min 2, max 10)
  // Expiration dropdown
}

async function createGroupPoll(groupId, pollData) {
  // POST /api/community-groups/:groupId/polls
  // { question, options: [], expiresIn: minutes }
  // Display poll in message feed
}
```

### 8. Group Poll Voting
**Location**: public/community.html - Poll display in message feed

**Components Needed**:
- Poll card with question and options
- Radio buttons or clickable options
- Vote button
- Results display:
  - Progress bars for each option
  - Percentage and vote counts
  - User's vote highlighted
  - Total vote count
  - "Poll ended" indicator if expired

**Implementation**:
```javascript
async function voteOnPoll(groupId, pollId, optionIndex) {
  // POST /api/community-groups/:groupId/polls/:pollId/vote
  // Update to show results view
  // Disable voting after user votes
}

async function loadPollResults(groupId, pollId) {
  // GET /api/community-groups/:groupId/polls/:pollId
  // Display results with progress bars
  // Highlight user's vote
}

function displayPoll(poll) {
  // If user hasn't voted: show voting interface
  // If user voted or poll expired: show results
  // Update progress bars with percentages
}
```

### 9. Socket.IO Event Listeners
**Location**: public/community.html - In socket connection setup

**Add these listeners**:
```javascript
socket.on('announcement:reaction', (data) => {
  updateAnnouncementReactions(data.announcementId, data.reactions);
});

socket.on('announcement:comment', (data) => {
  appendAnnouncementComment(data.comment);
});

socket.on('message:edited', (data) => {
  updateMessageContent(data.postId, data.content, data.editedAt);
});

socket.on('message:deleted', (data) => {
  updateMessageToDeleted(data.postId);
});

socket.on('message:reaction', (data) => {
  updateMessageReactions(data.postId, data.reactions);
});

socket.on('poll:created', (data) => {
  appendPollToFeed(data.poll);
});

socket.on('poll:voted', (data) => {
  updatePollResults(data.pollId, data.results);
});
```

## Design Guidelines

### Instagram-Style UI Patterns
1. **Reactions**: Use emoji-style buttons, show count bubbles
2. **Comments**: Indent thread style, show timestamp, author avatar
3. **Edit indicator**: Small "Edited" text in gray
4. **Deleted messages**: Gray background, italic text "[Message deleted]"
5. **Polls**: Card-style with rounded corners, progress bars in blue
6. **Context menus**: Bottom sheet on mobile, dropdown on desktop

### Color Scheme (from instagram.css)
- Primary: `var(--ig-primary-text)`
- Secondary: `var(--ig-secondary-text)`
- Blue accent: `var(--ig-blue)` (#0095f6)
- Border: `var(--ig-border)`
- Error: `var(--ig-error)` (#ed4956)

### Responsive Behavior
- Mobile: Bottom sheets for all modals
- Desktop: Centered modals with overlay
- Touch-friendly: 44px min tap targets
- Swipe gestures: Consider for message actions

## Testing Checklist

### Announcement Features
- [ ] Add reaction to announcement
- [ ] Remove reaction from announcement
- [ ] View reaction counts and user list
- [ ] Add comment to announcement
- [ ] Delete own comment
- [ ] Admin/moderator delete any comment
- [ ] Real-time reaction updates across users
- [ ] Real-time comment updates across users

### Group Message Features
- [ ] Edit own message
- [ ] Cannot edit others' messages
- [ ] Delete own message
- [ ] Admin delete any message
- [ ] Add reaction to message
- [ ] Remove reaction from message
- [ ] View reaction counts
- [ ] Reply to message with quote
- [ ] Forward message to another group
- [ ] Real-time edit/delete updates
- [ ] Real-time reaction updates

### Poll Features
- [ ] Create poll with 2-10 options
- [ ] Set poll expiration (or no expiration)
- [ ] Vote on poll (once per user)
- [ ] View live results after voting
- [ ] Cannot vote on expired poll
- [ ] See own vote highlighted
- [ ] Real-time vote count updates
- [ ] Poll displays in message feed

### Edge Cases
- [ ] Deleted message cannot be edited
- [ ] Reactions persist after message edit
- [ ] Comments remain after announcement edit
- [ ] Poll votes cannot be changed (INSERT OR REPLACE)
- [ ] Expired polls show "Ended" state
- [ ] Non-members cannot see/interact
- [ ] Timestamps in IST timezone

## Next Steps

1. **Phase 1**: Implement announcement reactions + comments UI
2. **Phase 2**: Implement message edit/delete UI
3. **Phase 3**: Implement message reactions UI
4. **Phase 4**: Implement poll creation + voting UI
5. **Phase 5**: Add all Socket.IO listeners
6. **Phase 6**: Comprehensive testing with multiple users

## File Modifications Summary

### Modified Files
- `config/database.js` - Added 6 tables + migration columns
- `routes/communities.js` - Added 180+ lines for reactions/comments
- `routes/community-groups.js` - Added 400+ lines for message features + polls
- `public/js/app.js` - IST timezone fixes (already done)

### Files to Modify Next
- `public/community.html` - Add all UI components (~1000+ lines)
- `public/css/instagram.css` - Add component styles (~200+ lines)

## API Endpoint Reference

### Announcements
```
POST   /api/communities/:id/announcements/:id/reactions
DELETE /api/communities/:id/announcements/:id/reactions/:type
GET    /api/communities/:id/announcements/:id/reactions
POST   /api/communities/:id/announcements/:id/comments
GET    /api/communities/:id/announcements/:id/comments
DELETE /api/communities/:id/announcements/:id/comments/:id
```

### Group Messages
```
PATCH  /api/community-groups/:groupId/posts/:postId
DELETE /api/community-groups/:groupId/posts/:postId
POST   /api/community-groups/:groupId/posts/:postId/reactions
DELETE /api/community-groups/:groupId/posts/:postId/reactions/:type
GET    /api/community-groups/:groupId/posts/:postId/reactions
```

### Polls
```
POST /api/community-groups/:groupId/polls
POST /api/community-groups/:groupId/polls/:pollId/vote
GET  /api/community-groups/:groupId/polls/:pollId
GET  /api/community-groups/:groupId/polls
```

## Validation Rules

- **Reactions**: 7 valid types (like, love, care, haha, wow, sad, angry)
- **Comments**: Max 500 chars, required content
- **Poll question**: Max 200 chars, required
- **Poll options**: Min 2, max 10, each max 100 chars
- **Poll expiration**: 1min to 30 days, or null (no expiration)
- **Message edit**: Only author, within 24h (optional limit)
- **Message delete**: Author or admin only

---

**Status**: Backend COMPLETE ✅ | Frontend IN PROGRESS 🚧
**Last Updated**: 2025-01-12
**Lines Added**: ~700+ backend lines, ~1200+ frontend lines remaining
