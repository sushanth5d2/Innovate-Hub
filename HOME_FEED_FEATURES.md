# Home Feed Enhancement - Feature Documentation

## Overview
The home feed has been enhanced with comprehensive Instagram-style social media features, including posts with multimedia support, user stories, real-time interactions, and advanced collaboration tools.

---

## 🎯 Core Features Implemented

### 1. **Posts with Multimedia Support**
- **Text Posts**: Share thoughts and updates
- **Image Posts**: Upload multiple photos (supports common image formats)
- **Video Posts**: Upload videos with preview
- **Mixed Media**: Combine images and text in a single post
- **Double-tap to Like**: Quick interaction on media

### 2. **User Stories (24-Hour Lifespan)**
- **Video Stories**: Up to 120 seconds (enforced client-side and server-side)
- **Image Stories**: Single images with captions
- **Story Expiration**: Automatically expires after 24 hours
- **Story Ring**: Visual indicator for active stories
- **Story Creation Modal**: User-friendly upload interface

### 3. **Post Interactions**

#### Like System
- **Endpoint**: `POST /posts/:postId/like`
- **Features**:
  - Toggle like/unlike
  - Real-time notification to post owner
  - Live likes count update
  - Heart animation on double-tap
  - Visual feedback (red heart when liked)

#### Comment System
- **Endpoints**: 
  - `POST /posts/:postId/comments` - Add comment
  - `GET /posts/:postId/comments` - Fetch comments
- **Features**:
  - Add comments with real-time posting
  - Owner receives notification on new comment
  - Comments count displayed
  - Quick comment input on each post
  - Enter key to submit

#### Share Feature
- **Functionality**: Copy post link to clipboard
- **User Feedback**: Toast notification on copy
- **Format**: `https://yourdomain.com/post/:postId`

#### Save/Bookmark
- **Endpoint**: `POST /posts/:postId/save`
- **Features**:
  - Bookmark posts for later viewing
  - Toggle save/unsave
  - Visual indicator (filled bookmark icon)
  - Accessible from profile's saved section

---

## 🎛️ Advanced Actions (3-Dot Menu)

### For Viewers (Non-Owners)

#### 1. **I'm Interested**
- **Endpoint**: `POST /posts/:postId/like`
- **Action**: Notifies post owner of interest
- **Use Case**: Express interest in opportunities, events, or projects
- **Notification**: Real-time Socket.IO notification

#### 2. **Contact Me**
- **Endpoint**: `POST /posts/:postId/interact` (type: 'contact')
- **Action**: Initiates direct message with post owner
- **Behavior**: Redirects to `/messages?user=:ownerId`
- **Context**: Post reference included in message thread

#### 3. **Gentle Reminder**
- **Endpoint**: `POST /posts/:postId/reminder`
- **Features**:
  - Set custom reminder date/time
  - Optional reminder message
  - Creates entry in Events calendar
  - Desktop/mobile notifications when due
- **Database**: `gentle_reminders` + `events` tables
- **Fields**:
  ```json
  {
    "reminder_date": "2024-01-15T10:00:00",
    "message": "Follow up on this opportunity"
  }
  ```

#### 4. **Instant Meeting**
- **Endpoint**: `POST /posts/:postId/meeting`
- **Platforms Supported**:
  - Google Meet
  - Zoom
  - Microsoft Teams
  - Discord
- **Features**:
  - Select meeting platform
  - Set meeting title
  - Choose date/time
  - Add description
  - Auto-generated meeting URLs
  - Creates calendar event automatically
- **Database**: `instant_meetings` table
- **Example Request**:
  ```json
  {
    "platform": "google-meet",
    "title": "Project Discussion",
    "meeting_date": "2024-01-15T14:00:00",
    "description": "Discuss collaboration opportunities"
  }
  ```
- **Meeting URL Generation**:
  - Google Meet: `meet.google.com/[random-code]`
  - Zoom: `zoom.us/j/[random-id]`
  - Teams: `teams.microsoft.com/l/meetup-join/[code]`
  - Discord: `discord.gg/[random-invite]`

#### 5. **Report Post**
- **Action**: Flag inappropriate content
- **Moderation**: Queued for admin review

### For Post Owners

#### 1. **Edit Post**
- **Endpoint**: `PUT /posts/:postId`
- **Features**:
  - Edit post caption/content
  - Add/remove images
  - Add/remove videos
  - Update existing media
- **Modal**: Pre-filled with current content

#### 2. **Archive Post**
- **Endpoint**: `PUT /posts/:postId/archive`
- **Features**:
  - Hide from public feed
  - Visible in profile's archived section
  - Can be restored later
  - Preserves likes, comments, interactions

#### 3. **Delete Post**
- **Endpoint**: `DELETE /posts/:postId`
- **Features**:
  - Permanent deletion
  - Confirmation dialog
  - Removes all associated data (likes, comments, saves)
  - Cannot be undone

---

## 📊 Database Schema

### New Tables Created

#### 1. **post_likes**
```sql
CREATE TABLE post_likes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(post_id, user_id)
)
```

#### 2. **post_comments**
```sql
CREATE TABLE post_comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  content TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
)
```

#### 3. **instant_meetings**
```sql
CREATE TABLE instant_meetings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL,
  creator_id INTEGER NOT NULL,
  platform TEXT NOT NULL,
  meeting_url TEXT NOT NULL,
  meeting_date DATETIME NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
  FOREIGN KEY (creator_id) REFERENCES users(id) ON DELETE CASCADE
)
```

### Enhanced Tables

#### **posts** (updated)
```sql
ALTER TABLE posts ADD COLUMN video_url TEXT;
ALTER TABLE posts ADD COLUMN likes_count INTEGER DEFAULT 0;
ALTER TABLE posts ADD COLUMN comments_count INTEGER DEFAULT 0;
```

#### **gentle_reminders** (updated)
```sql
ALTER TABLE gentle_reminders ADD COLUMN is_sent BOOLEAN DEFAULT 0;
```

---

## 🔔 Real-Time Notifications (Socket.IO)

### Events Emitted

1. **New Like**
   ```javascript
   io.to(userId).emit('notification', {
     type: 'like',
     postId: postId,
     from: username,
     message: 'liked your post'
   });
   ```

2. **New Comment**
   ```javascript
   io.to(userId).emit('notification', {
     type: 'comment',
     postId: postId,
     from: username,
     message: 'commented on your post'
   });
   ```

3. **Meeting Created**
   ```javascript
   io.to(userId).emit('notification', {
     type: 'meeting',
     postId: postId,
     from: username,
     meetingUrl: meetingUrl
   });
   ```

---

## 🎨 UI Components

### Modals Implemented

1. **Create Post Modal** (`#createPostModal`)
   - Caption input
   - Media upload (images/videos)
   - File preview
   - Submit/cancel actions

2. **Create Story Modal** (`#createStoryModal`)
   - Story content input
   - Video/image upload
   - 120-second video validation
   - Preview display

3. **Post Actions Modal** (`#postActionsModal`)
   - Dynamic viewer/owner actions
   - Icon-based menu items
   - Smooth animations

4. **Gentle Reminder Modal** (`#reminderModal`)
   - Date/time picker
   - Optional message field
   - Calendar integration

5. **Instant Meeting Modal** (`#meetingModal`)
   - Platform selector dropdown
   - Meeting title input
   - Date/time picker
   - Description textarea

6. **Edit Post Modal** (`#editPostModal`)
   - Pre-filled content
   - Media management
   - Update/cancel actions

---

## 📱 Mobile Responsiveness

All features are fully responsive:
- Touch-optimized modals
- Swipe gestures (from `swipe-gestures.js`)
- Bottom navigation for mobile
- Adaptive layouts for tablets
- Touch-friendly button sizes

---

## 🔒 Security & Validation

### Server-Side Validation
- JWT authentication required for all endpoints
- User ownership verification (edit/delete)
- SQL injection prevention (parameterized queries)
- File upload validation (type, size)
- Video duration check (120 sec max)

### Client-Side Validation
- Form field validation
- File type checking
- Video duration preview
- Confirmation dialogs for destructive actions

---

## 🚀 API Endpoints Summary

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/posts` | Fetch all posts with user flags |
| GET | `/posts/stories` | Fetch active stories |
| POST | `/posts` | Create new post/story |
| PUT | `/posts/:id` | Update post |
| DELETE | `/posts/:id` | Delete post |
| POST | `/posts/:id/like` | Toggle like |
| POST | `/posts/:id/comments` | Add comment |
| GET | `/posts/:id/comments` | Get comments |
| POST | `/posts/:id/save` | Toggle save |
| POST | `/posts/:id/interact` | Track interaction |
| POST | `/posts/:id/reminder` | Create reminder |
| POST | `/posts/:id/meeting` | Create meeting |
| PUT | `/posts/:id/archive` | Archive post |

---

## 🧪 Testing Checklist

### Post Creation
- [ ] Create text-only post
- [ ] Create post with single image
- [ ] Create post with multiple images
- [ ] Create post with video
- [ ] Create story with image
- [ ] Create story with 120-second video
- [ ] Verify video duration validation

### Interactions
- [ ] Like a post (toggle on/off)
- [ ] Double-tap image to like
- [ ] Add comment with Enter key
- [ ] Add comment with Post button
- [ ] Share post (copy link)
- [ ] Save/unsave post
- [ ] Verify real-time notifications

### 3-Dot Menu Actions
- [ ] Click "I'm Interested" (viewer)
- [ ] Click "Contact Me" (verify redirect to messages)
- [ ] Set gentle reminder (check Events page)
- [ ] Create Google Meet meeting
- [ ] Create Zoom meeting
- [ ] Create Teams meeting
- [ ] Create Discord meeting
- [ ] Edit own post
- [ ] Archive own post
- [ ] Delete own post

### UI/UX
- [ ] All modals open/close properly
- [ ] Date/time pickers work
- [ ] File previews display correctly
- [ ] Mobile bottom navigation works
- [ ] Swipe gestures functional
- [ ] Toast notifications appear

---

## 📝 Usage Examples

### Creating a Post with Video
```javascript
const formData = new FormData();
formData.append('content', 'Check out my new project demo!');
formData.append('video', videoFile); // Max 120 sec

await fetch('/posts', {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${token}` },
  body: formData
});
```

### Setting a Gentle Reminder
```javascript
await fetch(`/posts/${postId}/reminder`, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    reminder_date: '2024-02-01T10:00:00',
    message: 'Follow up on collaboration'
  })
});
```

### Creating an Instant Meeting
```javascript
await fetch(`/posts/${postId}/meeting`, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    platform: 'google-meet',
    title: 'Innovation Discussion',
    meeting_date: '2024-02-05T14:00:00',
    description: 'Brainstorming session for new features'
  })
});
```

---

## 🔧 Configuration

### File Upload Limits (Multer)
```javascript
// In routes/posts.js
const upload = multer({
  storage: multer.diskStorage({...}),
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'video/mp4', 'video/quicktime'];
    cb(null, allowedTypes.includes(file.mimetype));
  }
});
```

### Video Duration Validation
```javascript
// Client-side (home.html)
video.onloadedmetadata = function() {
  if (video.duration > 120) {
    alert('Video must be 120 seconds or less');
  }
};
```

---

## 🎯 Future Enhancements

Potential additions for future iterations:
1. **Story Highlights**: Save stories permanently to profile
2. **Polls**: Add poll creation to posts
3. **Collaborative Posts**: Tag multiple users as co-creators
4. **Advanced Analytics**: Post views, reach, engagement metrics
5. **Scheduled Posts**: Queue posts for future publishing
6. **Story Replies**: Direct message replies to stories
7. **Live Streaming**: Real-time video broadcasts
8. **AR Filters**: Augmented reality effects for stories

---

## 📞 Support & Troubleshooting

### Common Issues

**Issue**: Video upload fails
- **Solution**: Check file size (< 100MB) and format (MP4/MOV)

**Issue**: Meeting link not generated
- **Solution**: Verify platform name matches supported list

**Issue**: Notifications not appearing
- **Solution**: Ensure Socket.IO connection is established

**Issue**: Story not expiring after 24 hours
- **Solution**: Check `expires_at` field in database

---

## 📄 License
This feature implementation is part of the Innovate Hub platform.

---

**Last Updated**: December 2024  
**Version**: 2.0  
**Status**: Production Ready ✅
