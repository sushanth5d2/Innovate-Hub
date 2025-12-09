# Mobile Testing Guide

## Quick Start
1. Open http://localhost:3000 on your mobile device (or use Chrome DevTools Device Mode)
2. Register a new account or login
3. Test the features below

## Navigation Testing

### Hamburger Menu (Top Right)
```
Action: Tap the three-line icon (≡) in the top right
Expected: Side menu slides in from right
Expected: Shows all navigation links
Expected: Tap anywhere outside menu to close
```

### Menu Items
- Home → Should navigate to feed
- Communities → Should show community list
- Events → Should show events calendar
- Messages → Should open chat interface
- Notifications → Should show notification list
- Search → Should open search page
- **Settings** → Should open settings page (NEW!)

## Settings Page Testing

### Navigation
```
From Profile:
1. Go to your profile (tap profile pic or navigate)
2. Look for "Settings" button below "Edit Profile"
3. Tap Settings button
Expected: Navigate to /settings
```

```
From Mobile Menu:
1. Tap hamburger menu (≡)
2. Tap "Settings" at bottom of menu
Expected: Navigate to /settings
```

### Settings Features

#### Account Section
```
Test: View account info
Expected: See your username
Expected: See your email
Expected: "Edit Profile" button works
```

#### Preferences Section
```
Test: Toggle Crosspath
1. Tap checkbox next to "Enable Crosspath Feature"
Expected: Toast message "Crosspath enabled/disabled"
Expected: Setting saved (persists on refresh)

Test: Toggle Notifications
1. Tap checkbox next to "Enable Push Notifications"
Expected: Toast message appears
Expected: Setting saved

Test: Toggle Online Status
1. Tap checkbox next to "Show Online Status"
Expected: Toast message appears
Expected: Setting saved
```

#### Logout
```
Test: Logout Flow
1. Scroll to "Danger Zone" section
2. Tap red "Logout" button
Expected: Confirmation modal appears
Expected: Modal says "Are you sure you want to logout?"

3. Tap "Cancel"
Expected: Modal closes, you stay logged in

4. Tap "Logout" again, then tap red "Logout" in modal
Expected: API call made
Expected: Redirected to login page
Expected: Can't access /home without logging in again
```

#### Delete Account (Optional Test)
```
Test: Delete Account Flow
1. Tap "Delete Account" button
Expected: Modal appears asking for password
2. Tap "Cancel" to close
Expected: Account not deleted
```

## Mobile Layout Testing

### Responsive Breakpoints

#### Small Mobile (<480px)
```
Test on: iPhone SE, small Android phones
Expected: Single column layout
Expected: Compact spacing
Expected: Full-width buttons
Expected: Cards without rounded corners
Expected: 14px base font size
```

#### Mobile (480px-768px)
```
Test on: iPhone 12/13/14, most Android phones
Expected: Single column layout
Expected: Comfortable spacing
Expected: Readable text
Expected: Easy-to-tap buttons (48px+)
```

#### Tablet (768px-1024px)
```
Test on: iPad, Android tablets
Expected: Single column layout
Expected: Sidebars hidden
Expected: Centered content
```

### Touch Targets
```
Test: All interactive elements
Expected: Minimum 44x44 pixels
Expected: Easy to tap without zooming
Expected: No accidental taps

Elements to test:
- Hamburger menu button
- Navigation links
- Post buttons (Like, Comment, Share)
- Settings toggles
- Logout button
- Form inputs
- Submit buttons
```

### Forms & Inputs
```
Test: Input fields on mobile
1. Tap any text input
Expected: No automatic zoom on iOS
Expected: Keyboard appears smoothly
Expected: Input has 16px font size minimum

Test inputs:
- Login form
- Registration form
- Create post
- Send message
- Settings search (if added)
```

### Chat & Messages
```
Test: Mobile chat interface
1. Go to Messages
2. Open a conversation
Expected: Chat takes full height (minus header)
Expected: Message bubbles are 85% width max
Expected: Input at bottom is easy to reach
Expected: Smooth scrolling
```

### Modals
```
Test: Modal behavior on mobile
1. Try to create a post (or any modal)
Expected: Modal is full-screen
Expected: Easy to close
Expected: Scrollable content
Expected: Form inputs work well
```

## Orientation Testing

### Portrait Mode
```
Action: Hold phone normally (vertical)
Expected: All pages look good
Expected: Navigation accessible
Expected: Content readable
Expected: Buttons reachable with thumb
```

### Landscape Mode
```
Action: Rotate phone sideways (horizontal)
Expected: Layout adjusts gracefully
Expected: Navigation still accessible
Expected: Content doesn't overflow
Expected: Chat interface optimized
```

## Browser Testing

### iOS Safari
```
Device: iPhone (any model)
Browser: Safari
Test:
- Smooth scrolling with momentum
- No zoom on input focus
- Proper tap highlighting
- Back button works
- Home screen add (PWA)
```

### Chrome Mobile (Android)
```
Device: Android phone
Browser: Chrome
Test:
- All features work
- Fast tap response
- Proper rendering
- Share functionality
- Add to home screen
```

### Chrome Mobile (iOS)
```
Device: iPhone
Browser: Chrome
Test:
- Consistent with Safari
- All features work
```

## Performance Testing

### Page Load
```
Test: Initial page load on 3G
Expected: < 3 seconds
Monitor: Network throttling in DevTools
```

### Interactions
```
Test: Button tap response
Expected: < 100ms visual feedback
Expected: Smooth animations (60fps)

Test: Menu animations
Expected: Smooth slide-in/out
Expected: No jank or stuttering
```

### Scrolling
```
Test: Scroll through feed
Expected: Smooth 60fps scrolling
Expected: Momentum scrolling on iOS
Expected: No white flashes
Expected: Images load progressively
```

## Accessibility Testing

### Screen Reader
```
iOS: Turn on VoiceOver (Settings → Accessibility)
Android: Turn on TalkBack
Expected: All interactive elements announced
Expected: Proper navigation order
Expected: Buttons have descriptive labels
```

### Font Scaling
```
iOS: Settings → Display & Brightness → Text Size
Android: Settings → Display → Font Size
Test: Increase font size to maximum
Expected: Text scales appropriately
Expected: Layout doesn't break
Expected: All text remains readable
```

### Touch Targets
```
Test: Use accessibility inspector
Expected: All targets ≥ 44x44 pts
Expected: Adequate spacing between targets
```

## Issue Reporting

### If you find issues:
1. Note the device (e.g., "iPhone 13, iOS 16")
2. Note the browser (e.g., "Safari 16.1")
3. Describe what you did
4. Describe what happened
5. Describe what should happen
6. Screenshot if possible

### Common Issues to Watch For:
- ❌ Buttons too small to tap
- ❌ Text too small to read
- ❌ Layout breaks on certain screen sizes
- ❌ Hamburger menu doesn't open
- ❌ Settings don't save
- ❌ Logout doesn't work
- ❌ Modal doesn't show properly
- ❌ Keyboard covers input
- ❌ Scrolling is janky
- ❌ Images don't load

## Success Criteria

### Essential (Must Work)
✓ Hamburger menu opens/closes
✓ All navigation links work
✓ Settings page loads
✓ Logout works completely
✓ Layout is single-column on mobile
✓ Text is readable without zooming
✓ Buttons are tappable
✓ Forms work without zooming

### Nice to Have (Should Work)
✓ Smooth animations
✓ Fast load times
✓ Momentum scrolling
✓ Landscape mode looks good
✓ Settings save properly
✓ Toast notifications appear

### Future Enhancements
☐ PWA install prompt
☐ Offline mode
☐ Pull-to-refresh
☐ Dark mode
☐ Haptic feedback

---

**Start Testing**: Open http://localhost:3000 on your mobile device now!

**Quick Test (2 minutes)**:
1. ✓ Tap hamburger menu
2. ✓ Navigate to Settings
3. ✓ Toggle a preference
4. ✓ Logout and login again

**Full Test (10 minutes)**:
- Complete all sections above
- Test in both orientations
- Try different screen sizes
- Report any issues found
