# Testing Guide - Enhanced Home Feed Features

## Quick Start Testing

### Prerequisites
- Server must be running (`npm start`)
- At least 2 user accounts for testing interactions
- Test images/videos ready (videos max 120 seconds)

---

## Test Scenario 1: Post Creation & Media Upload

### Steps:
1. **Login** to the application
2. **Navigate** to Home page
3. **Click** the "+" icon in top or bottom navigation
4. **Create a text-only post**:
   - Enter caption: "Testing text post"
   - Click "Share"
   - ✅ Verify: Post appears in feed

5. **Create an image post**:
   - Click "+" again
   - Enter caption: "Testing image upload"
   - Click "Add Photos/Videos"
   - Select 1-3 images
   - ✅ Verify: Preview shows selected images
   - Click "Share"
   - ✅ Verify: Post appears with images

6. **Create a video post**:
   - Click "+" again
   - Enter caption: "Testing video"
   - Click "Add Photos/Videos"
   - Select a video (under 120 seconds)
   - ✅ Verify: Video preview appears
   - Click "Share"
   - ✅ Verify: Post appears with video player

7. **Test video validation**:
   - Try uploading video > 120 seconds
   - ✅ Verify: Alert appears warning about duration

---

## Test Scenario 2: Stories (24-Hour Posts)

### Steps:
1. **Click** "Your story" in stories carousel
2. **Add content**:
   - Enter text: "My test story"
   - Click "Add Photo or Video"
   - Select an image OR video (< 120 sec)
   - ✅ Verify: Preview displays correctly

3. **Submit story**:
   - Click "Share Story"
   - ✅ Verify: Story appears in carousel
   - ✅ Verify: Success notification shows

4. **View story**:
   - Click on your story ring
   - ✅ Verify: Story content displays

---

## Test Scenario 3: Like System

### Steps:
1. **Find a post** in feed
2. **Click heart icon**:
   - ✅ Verify: Heart turns red
   - ✅ Verify: Likes count increases
   - ✅ Verify: (If not your post) Owner receives notification

3. **Double-tap post image**:
   - ✅ Verify: Heart animation appears
   - ✅ Verify: Likes count updates

4. **Unlike the post**:
   - Click heart icon again
   - ✅ Verify: Heart turns white/outline
   - ✅ Verify: Likes count decreases

---

## Test Scenario 4: Comments

### Steps:
1. **Click comment icon** on any post
2. **Type a comment**: "Great post!"
3. **Press Enter** or **Click "Post"**
   - ✅ Verify: Comment submits
   - ✅ Verify: Input clears
   - ✅ Verify: Owner receives notification
   - ✅ Verify: Comments count increases

4. **View all comments**:
   - Click "View all X comments"
   - ✅ Verify: Redirects to post detail page

---

## Test Scenario 5: Share & Save

### Steps:
1. **Click share icon** (paper plane)
   - ✅ Verify: "Link copied!" notification appears
   - ✅ Verify: Can paste link in browser

2. **Click bookmark icon**:
   - ✅ Verify: Icon fills with color
   - ✅ Verify: Post is saved

3. **Click bookmark again**:
   - ✅ Verify: Icon becomes outline
   - ✅ Verify: Post is unsaved

---

## Test Scenario 6: 3-Dot Menu (Viewer Actions)

### Prerequisites: View someone else's post

### Steps:
1. **Click 3-dot menu** on a post you don't own

2. **Test "I'm Interested"**:
   - Click "I'm Interested"
   - ✅ Verify: Post owner receives notification
   - ✅ Verify: Success message appears

3. **Test "Contact Me"**:
   - Click 3-dot menu again
   - Click "Contact Me"
   - ✅ Verify: Redirects to `/messages?user=[ownerId]`
   - ✅ Verify: Message thread opens with post owner

4. **Test "Gentle Reminder"**:
   - Click 3-dot menu
   - Click "Gentle Reminder"
   - ✅ Verify: Reminder modal opens
   - Select a future date/time
   - Add message (optional): "Follow up on this"
   - Click "Set Reminder"
   - ✅ Verify: Success message
   - ✅ Verify: Navigate to Events page - reminder appears

5. **Test "Instant Meeting"**:
   - Click 3-dot menu
   - Click "Instant Meeting"
   - ✅ Verify: Meeting modal opens
   - **Select platform**: Google Meet
   - **Enter title**: "Test Meeting"
   - **Select date/time**: Future date
   - **Add description**: "Testing instant meeting"
   - Click "Create Meeting"
   - ✅ Verify: Meeting URL displayed
   - ✅ Verify: Event created (check Events page)
   - **Test all platforms**:
     - Google Meet → URL contains "meet.google.com"
     - Zoom → URL contains "zoom.us/j/"
     - Teams → URL contains "teams.microsoft.com"
     - Discord → URL contains "discord.gg/"

6. **Test "Report"**:
   - Click 3-dot menu
   - Click "Report"
   - ✅ Verify: Confirmation dialog appears

---

## Test Scenario 7: 3-Dot Menu (Owner Actions)

### Prerequisites: View your own post

### Steps:
1. **Click 3-dot menu** on your own post

2. **Test "Edit Post"**:
   - Click "Edit Post"
   - ✅ Verify: Edit modal opens
   - ✅ Verify: Current content is pre-filled
   - Change caption
   - Click "Add More Media" (optional)
   - Click "Save Changes"
   - ✅ Verify: Post updates in feed

3. **Test "Archive"**:
   - Click 3-dot menu
   - Click "Archive"
   - ✅ Verify: Confirmation dialog
   - Confirm action
   - ✅ Verify: Post removed from feed
   - ✅ Verify: Post appears in profile's archived section

4. **Test "Delete"**:
   - Create a new test post
   - Click 3-dot menu
   - Click "Delete"
   - ✅ Verify: "Are you sure?" confirmation
   - Confirm deletion
   - ✅ Verify: Post removed from feed
   - ✅ Verify: Success message appears

---

## Test Scenario 8: Real-Time Notifications

### Prerequisites: 2 browser windows (User A and User B)

### Steps:
1. **User A**: Create a post
2. **User B**: Like User A's post
   - ✅ Verify: User A receives real-time notification (no refresh needed)

3. **User B**: Comment on User A's post
   - ✅ Verify: User A receives comment notification

4. **User B**: Create instant meeting from User A's post
   - ✅ Verify: User A receives meeting notification with URL

---

## Test Scenario 9: Mobile Responsiveness

### Steps:
1. **Open browser DevTools** (F12)
2. **Toggle device toolbar** (Ctrl+Shift+M)
3. **Select mobile device**: iPhone 12 Pro

### Test:
- ✅ Bottom navigation visible and functional
- ✅ Top navigation adapts to mobile
- ✅ Stories scroll horizontally
- ✅ Modals fit screen size
- ✅ Date/time pickers work on mobile
- ✅ Video players work correctly
- ✅ Touch interactions (tap, double-tap, swipe)
- ✅ All buttons are easily tappable (44x44px minimum)

---

## Test Scenario 10: Edge Cases & Error Handling

### Steps:

1. **Test empty post creation**:
   - Open create post modal
   - Leave caption empty
   - Don't add media
   - Click "Share"
   - ✅ Verify: Error message appears

2. **Test comment without text**:
   - Click comment input
   - Leave empty and press Enter
   - ✅ Verify: Nothing happens (button disabled)

3. **Test meeting without required fields**:
   - Open instant meeting modal
   - Leave title empty
   - Click "Create Meeting"
   - ✅ Verify: Validation error appears

4. **Test reminder without date**:
   - Open gentle reminder modal
   - Leave date empty
   - Click "Set Reminder"
   - ✅ Verify: Validation error

5. **Test unauthorized actions**:
   - Try to edit someone else's post (via direct URL)
   - ✅ Verify: 403 Forbidden or redirect

6. **Test network errors**:
   - Open DevTools → Network tab
   - Set to "Offline"
   - Try to create a post
   - ✅ Verify: Appropriate error message
   - Set back to "Online"

---

## Test Scenario 11: Database Verification

### Steps:

1. **Check post_likes table**:
   ```sql
   SELECT * FROM post_likes ORDER BY created_at DESC LIMIT 10;
   ```
   - ✅ Verify: Entries created when liking posts

2. **Check post_comments table**:
   ```sql
   SELECT * FROM post_comments ORDER BY created_at DESC LIMIT 10;
   ```
   - ✅ Verify: Comments stored correctly

3. **Check instant_meetings table**:
   ```sql
   SELECT * FROM instant_meetings;
   ```
   - ✅ Verify: Meeting URLs generated correctly
   - ✅ Verify: Platform names match selection

4. **Check gentle_reminders table**:
   ```sql
   SELECT * FROM gentle_reminders WHERE is_sent = 0;
   ```
   - ✅ Verify: Future reminders exist

5. **Check posts table**:
   ```sql
   SELECT id, likes_count, comments_count, video_url FROM posts;
   ```
   - ✅ Verify: Counts update correctly
   - ✅ Verify: video_url populated for video posts

---

## Test Scenario 12: Performance Testing

### Steps:

1. **Load testing**:
   - Create 20+ posts
   - ✅ Verify: Page loads in < 2 seconds
   - ✅ Verify: Smooth scrolling

2. **Large file upload**:
   - Upload image > 10MB
   - ✅ Verify: Upload progress indication
   - ✅ Verify: Successful upload or size limit warning

3. **Multiple concurrent actions**:
   - Like 5 posts rapidly
   - Comment on 3 posts
   - Create a story
   - ✅ Verify: All actions complete successfully
   - ✅ Verify: No race conditions

---

## Browser Compatibility Testing

Test in the following browsers:

- ✅ Chrome (latest)
- ✅ Firefox (latest)
- ✅ Safari (latest)
- ✅ Edge (latest)
- ✅ Mobile Safari (iOS)
- ✅ Mobile Chrome (Android)

---

## Automated Testing Commands

### Run unit tests:
```bash
npm test
```

### Run integration tests:
```bash
npm run test:integration
```

### Check code coverage:
```bash
npm run test:coverage
```

---

## Reporting Issues

When reporting bugs, include:

1. **Steps to reproduce**
2. **Expected behavior**
3. **Actual behavior**
4. **Browser/device**
5. **Screenshots/video** (if applicable)
6. **Console errors** (F12 → Console tab)
7. **Network errors** (F12 → Network tab)

---

## Success Criteria

All features are considered working if:

✅ All test scenarios pass  
✅ No console errors  
✅ Real-time notifications work  
✅ Database entries created correctly  
✅ Mobile responsiveness verified  
✅ Error handling works properly  
✅ Performance is acceptable (< 2s load time)  
✅ Cross-browser compatibility confirmed

---

**Happy Testing! 🚀**

Last Updated: December 2024
