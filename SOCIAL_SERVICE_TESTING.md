# 🧪 Social Service & Crosspath Testing Guide

## Prerequisites
- Server running on http://localhost:3000
- At least 2 user accounts for testing
- Test images ready for donation uploads

---

## Test 1: Social Service - Create Donation

### Steps:
1. **Login** to account (User A - Donor)
2. **Navigate** to http://localhost:3000/social-service
3. **Click** "+" icon in top navigation
4. **Fill form**:
   - Title: "Winter Clothes Donation"
   - Description: "Warm clothes, jackets, and blankets for winter"
   - Click "Add Photos" and select 2-3 images
   - Address: "123 Main St, City"
   - Click "Use My Location" (if you want GPS)
5. **Click** "Post"

### Expected Results:
✅ Success message appears  
✅ Modal closes  
✅ Donation appears in "Donations" tab  
✅ Status badge shows "available"  
✅ Images are displayed  
✅ Location is shown with map icon  
✅ Edit and Delete buttons visible (owner only)

---

## Test 2: Social Service - Assign Donation

### Steps:
1. **Logout** from User A
2. **Login** to different account (User B - Receiver)
3. **Navigate** to `/social-service`
4. **Find** the donation created by User A
5. **Click** "Assign Me" button

### Expected Results:
✅ Success message: "Donation assigned to you!"  
✅ Donation disappears from "Donations" tab  
✅ Donation appears in "Picked" tab when you click it  
✅ Status shows "assigned"  
✅ "Unassign" and "Mark Complete" buttons visible  
✅ User A receives notification about assignment

---

## Test 3: Social Service - Upload Completion Photos

### Steps:
1. **Still logged in as User B** (the receiver)
2. **Go to** "Picked" tab
3. **Find** the donation you assigned
4. **Click** "Mark Complete"
5. **In modal**: Click "Add Photos"
6. **Select** 1-3 completion photos
7. **Click** "Upload"

### Expected Results:
✅ Success message: "Donation marked as complete!"  
✅ Modal closes  
✅ Completion photos appear under donation  
✅ Status changes to "completed"  
✅ "Unassign" and "Mark Complete" buttons disappear  
✅ User A (donor) receives notification: "has completed the donation pickup and uploaded photos"

---

## Test 4: Social Service - Edit Donation

### Steps:
1. **Login** as User A (donor)
2. **Go to** `/social-service`
3. **Find** your donation
4. **Click** "Edit" button
5. **Change** title to "Winter Clothes & Books"
6. **Add** more images
7. **Click** "Post"

### Expected Results:
✅ Success message: "Donation updated!"  
✅ Changes appear immediately  
✅ New images are shown  
✅ Title is updated

---

## Test 5: Social Service - Delete Donation

### Steps:
1. **Still logged in as User A**
2. **Create** a new test donation
3. **Click** "Delete" button
4. **Confirm** deletion

### Expected Results:
✅ Confirmation dialog appears  
✅ After confirm: "Donation deleted" message  
✅ Donation disappears from list

---

## Test 6: Social Service - Unassign Donation

### Steps:
1. **Login as User B** (receiver)
2. **Go to** "Picked" tab
3. **Find** a donation that's not completed
4. **Click** "Unassign"
5. **Confirm** action

### Expected Results:
✅ Success message: "Donation unassigned"  
✅ Donation disappears from "Picked" tab  
✅ Donation reappears in "Donations" tab for all users  
✅ Status changes back to "available"

---

## Test 7: Crosspath - Enable Feature

### Steps:
1. **Go to** `/settings`
2. **Find** "Crosspath" setting
3. **Click** toggle to enable
4. **Verify** it's enabled

### Expected Results:
✅ Toggle switches to ON (active state)  
✅ Message: "Crosspath enabled"  
✅ Setting persists on page refresh

---

## Test 8: Crosspath - Create and Accept Event

### Steps (User A):
1. **Go to** `/events`
2. **Click** "+" to create event
3. **Fill form**:
   - Title: "Watch Party - Big Game"
   - Date: Tomorrow
   - Description: "Let's watch together!"
4. **Click** "Create"

### Steps (User B):
1. **Login as User B**
2. **Go to** `/events`
3. **Find** the event created by User A
4. **Click** "Attend" button

### Expected Results:
✅ User A sees event created  
✅ User B sees event in list  
✅ After User B clicks attend:
  - User B's status changes to "attending"
  - User A receives notification about RSVP

---

## Test 9: Crosspath - Receive and Accept Request

### Steps (Automatic after Test 8):
1. **User A should receive crosspath notification**
2. **Both users go to** `/events` → "Crosspath" tab

### Steps (User A):
1. **Find** crosspath request from User B
2. **Click** "Accept"

### Expected Results:
✅ Crosspath request appears in both users' Crosspath tabs  
✅ Request shows: "{username} is also interested in the same event"  
✅ Accept/Decline buttons visible  
✅ After accept: "Crosspath accepted! You can now chat."  
✅ Both users can now message each other about the event

---

## Test 10: Crosspath - Start Chat

### Steps:
1. **After accepting crosspath**
2. **User A clicks** on User B's profile
3. **Click** "Message" button
4. **Send** message: "Hey! Excited for the watch party!"

### Expected Results:
✅ Chat opens  
✅ Message sends successfully  
✅ User B receives message notification  
✅ Real-time message delivery works

---

## Test 11: Crosspath - Decline Request

### Steps:
1. **Create** another event with different users
2. **Both accept** the event
3. **One user goes to** Crosspath tab
4. **Click** "Decline" on crosspath request

### Expected Results:
✅ Message: "Crosspath declined"  
✅ Request disappears from list  
✅ Other user doesn't see the declined request anymore

---

## Test 12: All Features Integration

### Steps:
1. **User A creates donation**
2. **User B assigns donation**
3. **User A creates event**
4. **User B accepts event**
5. **Crosspath request appears**
6. **User A accepts crosspath**
7. **They chat** about donation pickup at event

### Expected Results:
✅ All features work together seamlessly  
✅ Notifications sent for all actions  
✅ Real-time updates work  
✅ UI is responsive and fast

---

## 🐛 Common Issues & Solutions

### Issue 1: "Cannot read property of undefined"
**Solution**: Make sure you're logged in and have valid JWT token

### Issue 2: Images not uploading
**Solution**: Check file size (max 50MB) and file types (jpg, png, gif)

### Issue 3: GPS location not working
**Solution**: Allow location access in browser settings

### Issue 4: Notifications not appearing
**Solution**: Check Socket.IO connection in browser console

### Issue 5: Crosspath not triggering
**Solution**: 
- Make sure Crosspath is enabled in Settings
- Both users must accept the SAME event
- Wait a few seconds for notification

---

## ✅ Success Criteria

All features working if:

- ✅ Can create donation with images
- ✅ Can assign/unassign donations
- ✅ Can upload completion photos
- ✅ Can edit/delete donations
- ✅ Crosspath toggle works
- ✅ Crosspath requests appear
- ✅ Can accept/decline crosspath
- ✅ Can chat after crosspath acceptance
- ✅ Notifications work for all actions
- ✅ Real-time updates work
- ✅ No console errors

---

## 📊 Test Results Template

```
Date: ___________
Tester: ___________

Test 1 - Create Donation: ☐ Pass ☐ Fail
Test 2 - Assign Donation: ☐ Pass ☐ Fail
Test 3 - Upload Completion: ☐ Pass ☐ Fail
Test 4 - Edit Donation: ☐ Pass ☐ Fail
Test 5 - Delete Donation: ☐ Pass ☐ Fail
Test 6 - Unassign Donation: ☐ Pass ☐ Fail
Test 7 - Enable Crosspath: ☐ Pass ☐ Fail
Test 8 - Create Event: ☐ Pass ☐ Fail
Test 9 - Accept Crosspath: ☐ Pass ☐ Fail
Test 10 - Start Chat: ☐ Pass ☐ Fail
Test 11 - Decline Crosspath: ☐ Pass ☐ Fail
Test 12 - Integration: ☐ Pass ☐ Fail

Overall Status: ☐ All Pass ☐ Some Fail

Notes:
_______________________
_______________________
```

---

## 🎯 Quick Test Commands

```bash
# Check server is running
curl http://localhost:3000/api/social-service/donations

# Check database tables
sqlite3 database/innovate.db "SELECT * FROM donations;"
sqlite3 database/innovate.db "SELECT * FROM donation_assigns;"
sqlite3 database/innovate.db "SELECT * FROM crosspath_events;"

# Check logs
tail -f /var/log/node-app.log
```

---

**Happy Testing! 🚀**

Last Updated: December 24, 2024  
Server: http://localhost:3000  
Status: ✅ All Features Implemented
