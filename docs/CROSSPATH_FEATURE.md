# Crosspath Feature - Location-Based Event Networking

##  Overview
Crosspath enables event attendees to discover and connect with other attendees who are within 500 meters of their location. Users must enable crosspath for each event they're attending and grant location permissions.

## 🎯 How It Works

### For Users:
1. **Enable Crosspath**: Toggle crosspath ON for upcoming events you're attending
2. **Grant Location Permission**: Browser will request location access
3. **Auto-Discovery**: When another attendee with crosspath enabled is within 500m, both users are notified
4. **Connect**: View matched users in the Crosspath tab and DM them directly

### Technical Flow:
1. User enables crosspath → location stored in `crosspath_locations` table
2. Location updated every 30 seconds while crosspath is active
3. Backend calculates distance using Haversine formula (great-circle distance)
4. When users within 500m → creates entry in `crosspath_matches` table
5. Real-time notifications sent via Socket.IO to both users
6. Users can DM matched attendees directly from Crosspath tab

## 📊 Database Schema

### `crosspath_locations`
```sql
- user_id: User with crosspath enabled
- event_id: Event they're attending
- latitude, longitude: Current location
- is_active: Whether crosspath is currently enabled
- last_updated: Timestamp of last location update
```

### `crosspath_matches`
```sql
- event_id: Event where match occurred
- user1_id, user2_id: Matched users
- distance_meters: Distance when matched
- matched_at: Timestamp of match
- notification_sent: Whether push notification was sent
```

## 🔌 API Endpoints

### Enable Crosspath
```http
POST /api/events/:eventId/crosspath/enable
Body: { latitude, longitude }
```
- Checks user is attending/creating the event
- Stores location in database
- Immediately checks for nearby users

### Disable Crosspath
```http
POST /api/events/:eventId/crosspath/disable
```
- Sets `is_active = 0` for the event
- Stops location tracking if no events remain

### Update Location
```http
POST /api/events/:eventId/crosspath/update-location
Body: { latitude, longitude }
```
- Called every 30 seconds by frontend
- Updates location and checks for new matches

### Get Matches
```http
GET /api/events/:eventId/crosspath/matches
```
- Returns all users matched for this event
- Includes distance, profile info, and match timestamp

## 🎨 UI Features

### Crosspath Tab
- **Event Toggles**: Each upcoming event has an iOS-style toggle switch
- **Nearby Attendees**: Shows matched users with:
  - Profile picture
  - Username
  - Event name
  - Distance (e.g., "342m away")
  - Time matched (e.g., "5m ago")
  - DM button

### Location Tracking
- Requests geolocation permission on first enable
- Updates location every 30 seconds in background
- Stops tracking when all crosspaths disabled
- High accuracy mode enabled

## 🔔 Notifications

### Real-Time (Socket.IO)
```javascript
io.to(`user_${userId}`).emit('notification:received', {
  type: 'crosspath_match',
  content: '@username is nearby at EventName! (342m away)',
  related_id: otherUserId
});
```

### Database Storage
- All matches stored in `notifications` table
- Type: `'crosspath_match'`
- `related_id` contains the other user's ID for quick DM access

## 🔒 Privacy & Permissions

### Requirements:
- ✅ User must be attending/creating the event
- ✅ User must manually enable crosspath per event
- ✅ Browser geolocation permission required
- ✅ Can disable anytime

### Location Handling:
- Stored only while crosspath is active
- Last 10 minutes of locations considered valid
- Set `is_active = 0` removes from matching pool
- No location history stored after disabling

## 📱 Frontend Implementation

### Key Functions:
- `enableCrossPath(eventId)` - Activates crosspath with location
- `disableCrossPath(eventId)` - Deactivates crosspath
- `startLocationTracking()` - Begins 30s interval updates
- `stopLocationTracking()` - Clears interval when no events active
- `loadCrosspath()` - Renders UI with toggles and matches
- `openDM(userId)` - Navigates to messages with user

### State Management:
```javascript
crosspathState = {
  enabledEvents: Set(), // Track which events have crosspath on
  watchId: null // Geolocation watch ID
}
```

## 🚀 Usage Example

```javascript
// User enables crosspath for event ID 123
POST /api/events/123/crosspath/enable
{ "latitude": 17.3850, "longitude": 78.4867 }

// Backend checks for nearby users
// Finds @alice at distance 342m
// Creates match in crosspath_matches
// Sends Socket.IO notification to both users

// Frontend shows in Crosspath tab:
// 🎯 @alice
// Single to Mingle Week • 342m away
// 5m ago
// [💬 DM]
```

## 🎯 Distance Calculation

Uses **Haversine formula** for accurate great-circle distance:
```javascript
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371e3; // Earth radius in meters
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lon2 - lon1) * Math.PI / 180;

  const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
            Math.cos(φ1) * Math.cos(φ2) *
            Math.sin(Δλ/2) * Math.sin(Δλ/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

  return R * c; // Returns meters
}
```

## 🎨 Styling

### Toggle Switch CSS
```css
.crosspath-toggle input:checked + .crosspath-slider {
  background-color: #00d4aa; /* Green when enabled */
}
```

### Match Cards
- Profile pictures with green border (indicating active)
- Distance badge
- Time ago formattime
- Primary DM button for quick connection

## 🔄 Auto-Cleanup

Inactive locations (>10 minutes old) automatically excluded from matching:
```sql
WHERE datetime(cl.last_updated) > datetime('now', '-10 minutes')
```

## 📈 Performance Considerations

- Location updates: 30 second intervals (not real-time)
- Proximity checks: Only against active users in same event
- Distance calculation: O(n) where n = active users per event
- Socket.IO: Targeted room emissions (`user_${userId}`)
- No geofencing APIs required - pure calculation

## 🎉 User Benefits

1. **Networking Made Easy**: Discover attendees before the event
2. **Icebreaker**: "Hey, saw you're nearby!" conversation starter
3. **Safety**: Connect with others heading to the venue
4. **Spontaneous Meetups**: "I'm at the coffee shop 200m away!"
5. **Event Experience**: Feel connected to the community

---

**✨ Feature Status**: ✅ Fully Implemented
**📱 Mobile Ready**: ✅ PWA Compatible
**🔔 Real-time**: ✅ Socket.IO Notifications
**🔒 Privacy First**: ✅ Opt-in per event
