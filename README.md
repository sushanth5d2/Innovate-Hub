# Innovate Hub - Cross-Platform Social Media App

A feature-rich social media platform focused on creativity, networking, and community engagement, with special emphasis on sports fanaticism and fan communities. **Now featuring a complete Instagram-inspired UI redesign and ready for Android/iOS deployment!**

## 📱 Platform Availability

- ✅ **Progressive Web App (PWA)** - Install from any browser
- ✅ **Android App** - Ready for Google Play Store
- ✅ **iOS App** - Ready for Apple App Store  
- ✅ **Web Browser** - Works on any device

## 🎨 New Instagram-Style Interface

### Design Features
- **Dark/Light Theme Toggle**: Automatic theme detection with manual toggle in settings
- **Instagram-Style Navigation**: Top navigation bar with logo, search, and icons
- **Bottom Navigation Bar**: Quick access to Home, Search, Communities, Events, and Profile
- **Stories Carousel**: Horizontal scrolling stories with gradient rings
- **Instagram-Style Posts**: Complete with like, comment, share, save, and 3-dot menu
- **Instagram DMs**: Message interface matching Instagram's design
- **Swipe Gestures**: Swipe right on home page to navigate to messages
- **Modern Typography**: -apple-system font stack for native feel
- **Smooth Animations**: Like animations, theme transitions, and interaction feedback
- **Offline Support**: Works without internet connection
- **Push Notifications**: Real-time alerts even when app is closed

### Core Features
- **User Authentication**: Registration, login, logout, forgot password
- **Settings Page**: Instagram-style settings with theme toggle, privacy controls
- **Home Feed**: Instagram-style posts with full multimedia support
  - Text, images, and video posts (up to 120 seconds)
  - Like/unlike with real-time notifications
  - Comment system with owner notifications
  - Share (copy link to clipboard)
  - Save/bookmark posts
  - 3-dot menu with advanced actions:
    - **Viewers**: I'm Interested, Contact Me, Gentle Reminder, Instant Meeting, Report
    - **Owners**: Edit, Archive, Delete
- **User Stories**: 24-hour temporary posts with image/video support (120 sec max)
- **Messaging**: Instagram DM-style real-time chat with file attachments
- **Communities**: Create/join communities with team-specific features
- **Events**: Create events, RSVP, calendar view, crosspath feature
- **User Profiles**: Customizable profiles with bio, skills, interests, favorite teams
- **Notifications**: Real-time Socket.IO notifications for all activities
- **Search**: Find users and communities
- **Mobile-Responsive Design**: Instagram-optimized mobile experience with gestures

### Advanced Interaction Features
- **Gentle Reminders**: Schedule notifications for any post with custom date/time and message
  - Creates entry in Events calendar
  - Desktop/mobile notifications when due
- **Instant Meetings**: Create video meetings directly from posts
  - Platforms: Google Meet, Zoom, Microsoft Teams, Discord
  - Auto-generated meeting URLs
  - Calendar integration
  - Scheduled notifications
- **Contact Me**: Instantly start a DM with post owner
- **Post Engagement**: Track user interactions (interested, contact, share)
- **Real-time Updates**: Live likes count and comments count via Socket.IO

### Sports Fan Features
- Team-specific community groups
- Sports polls (e.g., "Who will win?")
- Fan bonding activities
- Real-time game discussion threads
- Custom community banners with team logos

### Special Features
- **Crosspath**: When users join the same event, they receive notifications to connect and chat
- **Double-tap to Like**: Quick interaction on post images/videos
- **Video Support**: Upload and share videos in posts and stories (max 120 seconds)
- **Archive Posts**: Hide posts from feed without deleting
- **Post Interactions**: "I'm Interested", Contact, Share, Save

## 🎨 Instagram-Style Interface

### Updated Pages (10/10 Core Pages - 100% Complete!)
- ✅ **Home Feed** - Instagram-style posts, stories carousel, swipe gestures
- ✅ **Messages** - Instagram DM interface with real-time chat
- ✅ **Settings** - Dark/light theme toggle, privacy controls
- ✅ **Notifications** - Activity feed with follow/unfollow actions
- ✅ **Search** - Explore users and communities with tabbed interface
- ✅ **Login/Register** - Instagram-authentic auth pages
- ✅ **Profile** - Instagram-style profile with edit modal
- ✅ **Communities** - Card-based community browser
- ✅ **Events** - Instagram-style events with crosspath and reminders

### All Bugs Fixed
- ✅ **Messages SQL Bug** - Fixed column alias issue in conversations query

## Tech Stack

### Backend
- Node.js with Express
- Socket.IO for real-time features
- SQLite (development) / PostgreSQL (production)
- JWT authentication
- Multer for file uploads

### Frontend
- **Instagram CSS Theme** (864 lines) - Complete dark/light mode system
- **Theme Switcher** - Auto-detection + manual toggle
- **Swipe Gestures** - Touch-optimized navigation
- **Service Worker** - Offline support and PWA functionality
- HTML5, CSS3, JavaScript
- Socket.IO client
- Responsive mobile-first design

### Mobile & PWA
- **Capacitor** - Native iOS/Android builds
- **PWA Manifest** - Install to home screen
- **Service Worker** - Offline caching and background sync
- **Push Notifications** - Web Push API
- **App Icons** - All sizes (72px to 512px)

## 📱 Mobile App Deployment

### Quick Start
```bash
# Install dependencies
npm install

# For Android
npx cap sync android
npx cap open android

# For iOS (requires Mac)
npx cap add ios
npx cap sync ios
npx cap open ios
```

### Complete Documentation
- 📘 **[Deployment Guide](docs/DEPLOYMENT_GUIDE.md)** - Complete guide for all platforms
- 🤖 **[Android Build](docs/ANDROID_BUILD.md)** - Google Play Store submission
- 🍎 **[iOS Build](docs/IOS_BUILD.md)** - Apple App Store submission
- 🎉 **[Mobile Deployment Complete](docs/MOBILE_DEPLOYMENT_COMPLETE.md)** - What's ready now

### App Store Requirements
**Google Play Store:**
- $25 one-time developer fee
- Signed AAB file
- Screenshots and descriptions
- Privacy policy

**Apple App Store:**
- $99/year developer account
- Mac computer for builds
- Xcode for archiving
- Screenshots for all device sizes

## Installation

### Prerequisites
- Node.js (v14 or higher)
- npm or yarn

### Setup Steps

1. **Clone the repository**
   ```bash
   cd /workspaces/Innovate-Hub
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Environment Configuration**
   - Copy `.env.example` to `.env`
   - Update the values as needed (default values work for development)

4. **Create required directories**
   ```bash
   mkdir -p database uploads/images uploads/files uploads/profiles uploads/community
   ```

5. **Start the server**
   
   For development (with auto-reload):
   ```bash
   npm run dev
   ```
   
   For production:
   ```bash
   npm start
   ```

6. **Access the application**
   - Open your browser and navigate to `http://localhost:3000`

## Project Structure

```
Innovate-Hub/
├── config/
│   └── database.js          # Database configuration
├── middleware/
│   ├── auth.js              # Authentication middleware
│   └── upload.js            # File upload middleware
├── routes/
│   ├── auth.js              # Authentication routes
│   ├── posts.js             # Posts and stories routes
│   ├── messages.js          # Messaging routes
│   ├── communities.js       # Communities routes
│   ├── events.js            # Events routes
│   ├── users.js             # User profile routes
├── public/
│   ├── css/
│   │   └── style.css        # Main stylesheet with mobile-responsive design
│   ├── js/
│   │   └── app.js           # Frontend JavaScript utilities
│   ├── login.html           # Login page
│   ├── register.html        # Registration page
│   ├── home.html            # Home feed
│   ├── messages.html        # Messaging interface
│   ├── communities.html     # Communities page
│   ├── events.html          # Events page
│   ├── search.html          # Search page
│   ├── notifications.html   # Notifications page
│   ├── profile.html         # User profile page
│   ├── settings.html        # Settings and logout page
│   └── community.html       # Community detail page
│   ├── messages.html        # Messaging interface
│   └── communities.html     # Communities page
├── uploads/                 # User-uploaded files
├── database/                # SQLite database files
├── .env                     # Environment variables
├── .env.example             # Environment template
├── server.js                # Main server file
├── package.json             # Dependencies
└── README.md                # This file
```

## API Endpoints

### Authentication
- `POST /api/auth/register` - Register new user
- `POST /api/auth/login` - Login user
- `POST /api/auth/logout` - Logout user
- `POST /api/auth/forgot-password` - Request password reset

### Posts
- `GET /api/posts` - Get all posts
- `GET /api/posts/stories` - Get stories
- `POST /api/posts` - Create post
- `POST /api/posts/:postId/poll` - Create poll
- `POST /api/posts/:postId/interact` - Interact with post
- `POST /api/posts/:postId/save` - Save post
- `PUT /api/posts/:postId` - Update post
- `DELETE /api/posts/:postId` - Delete post

### Messages
- `GET /api/messages/conversations` - Get conversations
- `GET /api/messages/:contactId` - Get messages with user
- `POST /api/messages` - Send message
- `PUT /api/messages/:messageId` - Edit message
- `DELETE /api/messages/:messageId` - Delete message

### Communities
- `GET /api/communities` - Get all communities
- `GET /api/communities/:id` - Get community details
- `POST /api/communities` - Create community
- `POST /api/communities/:id/join` - Join community
- `POST /api/communities/:id/leave` - Leave community
- `GET /api/communities/:id/posts` - Get community posts
- `POST /api/communities/:id/posts` - Create community post
- `GET /api/communities/:id/chat` - Get community chat
- `POST /api/communities/:id/chat` - Send community chat message

### Events
- `GET /api/events` - Get events
- `POST /api/events` - Create event
- `POST /api/events/:id/rsvp` - RSVP to event
- `GET /api/events/crosspath/requests` - Get crosspath requests
- `POST /api/events/crosspath/:id/respond` - Accept/decline crosspath

### Users
- `GET /api/users/:userId` - Get user profile
- `PUT /api/users` - Update profile
- `POST /api/users/:userId/follow` - Follow user
- `DELETE /api/users/:userId/follow` - Unfollow user
- `POST /api/users/:userId/block` - Block user

### Search
- `GET /api/search/users?q=query` - Search users
- `GET /api/search/communities?q=query` - Search communities

## Socket.IO Events

### Client to Server
- `user:join` - User connects with userId
- `community:join` - Join community room
- `message:send` - Send message
- `community:message` - Send community message
- `typing:start` - Start typing indicator
- `typing:stop` - Stop typing indicator

### Server to Client
- `user:online` - User came online
- `user:offline` - User went offline
- `message:receive` - New message received
- `community:message:receive` - New community message
- `notification:receive` - New notification
- `typing:start` - User started typing
- `typing:stop` - User stopped typing

## Database Schema

### Main Tables
- **users** - User accounts and profiles
- **posts** - User posts and stories
- **polls** - Polls attached to posts
- **messages** - Direct messages
- **communities** - Community groups
- **community_members** - Community memberships
- **community_posts** - Posts within communities
- **community_chat** - Community chat messages
- **events** - Events and meetings
- **event_attendees** - Event RSVPs
- **crosspath_events** - Crosspath connections
- **notifications** - User notifications
- **followers** - Follow relationships
- **blocked_users** - Blocked users
- **saved_posts** - Saved posts
- **gentle_reminders** - Scheduled reminders

## Development vs Production

### Development (SQLite)
- Uses local SQLite database
- Database file: `./database/innovate.db`
- Automatic table creation on startup
- Perfect for testing and development

### Production (PostgreSQL)
1. Set up PostgreSQL database
2. Update `.env` file:
   ```
   DB_TYPE=postgresql
   PG_HOST=your-host
   PG_PORT=5432
   PG_USER=your-user
   PG_PASSWORD=your-password
   PG_DATABASE=innovate_hub
   ```
3. Run database migrations (manual setup required)

## Features Roadmap

### ✅ Phase 1 (Completed!)
- ✅ User authentication
- ✅ Posts and stories
- ✅ Real-time messaging
- ✅ Communities
- ✅ Events with crosspath
- ✅ Notifications
- ✅ Settings page with logout
- ✅ Mobile-responsive design
- ✅ Instagram-style UI (all pages)
- ✅ PWA configuration
- ✅ Android app ready
- ✅ iOS app ready
- ✅ Service worker (offline support)
- ✅ Push notifications
- ✅ App icons generated

### Phase 2 (Ready to Launch!)
- [ ] Submit to Google Play Store
- [ ] Submit to Apple App Store
- [ ] Beta testing with TestFlight/Play Console
- [ ] Collect user feedback
- [ ] Marketing and promotion

### Phase 3 (Future Enhancements)
- Advanced search filters
- Video posts and stories
- Live streaming for events
- Community moderation tools
- Analytics dashboard
- AR filters (Instagram-style)
- Creator Series/short videos
- Shopping integration

## Contributing

This project is built for educational and demonstration purposes. Feel free to extend and customize it for your needs.

## License

ISC

## Support

For issues and questions, please refer to the documentation or create an issue in the repository.

---

**Built with ❤️ for creatives, professionals, and sports fans everywhere!**