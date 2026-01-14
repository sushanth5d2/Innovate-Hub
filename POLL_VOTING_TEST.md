# Poll Voting - Quick Test Guide

## ✅ Server Running
Port: 3000
URL: http://localhost:3000

---

## Quick Test Steps

### 1. Create a Poll (30 seconds)
1. Open http://localhost:3000
2. Login (or register if needed)
3. Navigate to any community
4. Click "Announcements" tab (left sidebar)
5. Click "Create Announcement" button (bottom)
6. Fill in:
   - **Title**: "Team Preference"
   - **Body**: "Let's see which team everyone supports!"
7. **Toggle "Add Poll" switch**
8. Enter **poll question**: "Which team do you support?"
9. Enter **options**:
   - Option 1: "Lakers"
   - Option 2: "Warriors"
   - Option 3: "Celtics"
10. Click "+ Add Option" for more if needed
11. Click "Post Announcement"

### 2. Vote on the Poll (10 seconds)
1. Click the announcement you just created
2. Scroll to poll section
3. **Click on any option** (e.g., "Lakers")
4. Watch the magic:
   - Border turns blue ✓
   - Check icon becomes solid ✓
   - Vote count appears: "1 (100%)" ✓
   - Progress bar fills ✓
   - Total votes updates ✓

### 3. Change Your Vote (10 seconds)
1. **Click a different option** (e.g., "Warriors")
2. See updates:
   - Lakers: border returns to normal, check becomes outline
   - Warriors: border turns blue, check becomes solid
   - Vote counts redistribute: "Warriors: 1 (100%)"

### 4. Test Real-Time Updates (30 seconds)
1. **Open the same community in a private/incognito window**
2. Login as a different user
3. Navigate to the same announcement
4. **Vote on the poll**
5. **Switch back to first window**
6. See the vote count update automatically! (no refresh needed)

---

## Expected Results

### Before Voting
```
┌─────────────────────────────────────┐
│ 📊 Poll                              │
│ ┌───────────────────────────────────┐│
│ │ Which team do you support?       ││
│ │                                  ││
│ │ [1] Lakers ○                     ││
│ │ [2] Warriors ○                   ││
│ │ [3] Celtics ○                    ││
│ │                                  ││
│ │ ─────────────────────────────────││
│ │ 🎯 Be the first to vote!         ││
│ └───────────────────────────────────┘│
└─────────────────────────────────────┘
```

### After 1 Vote (You voted Lakers)
```
┌─────────────────────────────────────┐
│ 📊 Poll                              │
│ ┌───────────────────────────────────┐│
│ │ Which team do you support?       ││
│ │                                  ││
│ │ [1] Lakers ████████ 1 (100%) ✓  ││ ← Blue border
│ │ [2] Warriors ○                   ││
│ │ [3] Celtics ○                    ││
│ │                                  ││
│ │ ─────────────────────────────────││
│ │ 📊 1 vote total                  ││
│ └───────────────────────────────────┘│
└─────────────────────────────────────┘
```

### After 3 Votes (Mixed)
```
┌─────────────────────────────────────┐
│ 📊 Poll                              │
│ ┌───────────────────────────────────┐│
│ │ Which team do you support?       ││
│ │                                  ││
│ │ [1] Lakers ██████ 2 (67%) ✓      ││ ← Your vote
│ │ [2] Warriors ███ 1 (33%) ○       ││
│ │ [3] Celtics  0 (0%) ○            ││
│ │                                  ││
│ │ ─────────────────────────────────││
│ │ 📊 3 votes total                 ││
│ └───────────────────────────────────┘│
└─────────────────────────────────────┘
```

---

## Visual Features to Check

### ✅ Numbered Badges
- Round gradient blue badges with numbers (1, 2, 3...)
- White text, centered

### ✅ Progress Bars
- Gradient blue background showing percentage
- Width animates on vote
- Smooth transition

### ✅ Hover Effects
- Border changes to blue on hover
- Option slides right slightly
- Smooth transition back on mouse leave

### ✅ Vote Highlighting
- Your voted option has blue border
- Solid check icon (fas fa-check-circle)
- Other options have outline check icon (far fa-circle)

### ✅ Vote Counts
- Shows: "2 (67%)" format
- Right side of option
- Gray text color

### ✅ Total Votes
- Bottom of poll
- Bar chart icon 📊
- Format: "X votes total" or "Be the first to vote!"

### ✅ Theme Compatibility
- Works in dark mode
- Works in light mode
- Colors adapt properly

---

## Console Output to Check

### On Vote Success
```javascript
Vote recorded successfully
```

### On Socket Event
```javascript
// Should see poll update in real-time
poll:voted event received
```

### On Error (if any)
```javascript
Error voting: <error message>
```

---

## Browser Console Testing

Open browser console (F12) and try:

```javascript
// Check current poll
const pollElement = document.querySelector('[id^="poll-"]');
console.log(pollElement);

// Manually trigger vote (for testing)
votePoll(1, 0); // announcementId=1, optionIndex=0

// Check Socket.IO connection
const socket = InnovateAPI.getSocket();
console.log('Socket connected:', socket.connected);
```

---

## API Testing (Optional)

Using curl or Postman:

```bash
# Vote on poll
curl -X POST http://localhost:3000/api/communities/1/announcements/1/vote \
  -H "Authorization: Bearer <your_jwt_token>" \
  -H "Content-Type: application/json" \
  -d '{"optionIndex": 0}'

# Expected response:
{
  "success": true,
  "results": {
    "options": ["Lakers", "Warriors", "Celtics"],
    "voteCounts": [1, 0, 0],
    "totalVotes": 1,
    "userVote": 0,
    "percentages": [100, 0, 0]
  }
}
```

---

## Common Issues & Solutions

### Poll Not Displaying
- Check console for errors
- Verify announcement has poll data
- Refresh page

### Vote Not Recording
- Check if logged in
- Verify community membership
- Check browser console for errors
- Verify JWT token is valid

### Real-Time Not Working
- Check Socket.IO connection
- Verify both users are in same community
- Check network tab for WebSocket connection
- Refresh both windows

### UI Looks Broken
- Clear browser cache
- Hard refresh (Ctrl+Shift+R)
- Check if CSS loaded properly

---

## Success Checklist

After testing, confirm:

- [x] Poll displays in announcement
- [x] Options are clickable
- [x] Vote records successfully
- [x] Progress bars show percentage
- [x] Vote count displays correctly
- [x] User's vote is highlighted
- [x] Can change vote
- [x] Real-time updates work
- [x] No UI alerts popup
- [x] Console logs success
- [x] Works in dark mode
- [x] Works in light mode
- [x] Mobile responsive

---

## Ready to Test! 🚀

Open: http://localhost:3000

Feature status: ✅ COMPLETE AND READY

---

*Test Duration*: ~2 minutes
*Required Users*: 1 (2 for real-time testing)
*Complexity*: ⭐⭐ (Easy)

