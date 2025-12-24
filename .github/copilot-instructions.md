# Innovate Hub - AI Coding Agent Instructions

## Project Overview
Cross-platform social media platform with Instagram-style UI, ML-powered recommendations, and native mobile apps. Built with Node.js backend, Python ML microservice, and vanilla JavaScript frontend with Capacitor for mobile deployment.

## Architecture: Multi-Service Stack

### Backend Services (Port 3000)
- **Node.js/Express** - Main API server ([server.js](../server.js))
- **Socket.IO** - Real-time features (messages, notifications, typing indicators, WebRTC calls)
- **SQLite** (dev) / **PostgreSQL** (prod) - Primary database
- **Redis** (optional) - Caching layer

### ML Microservice (Port 5000)
- **Python/Flask** - Separate service ([ml-service/app.py](../ml-service/app.py))
- **Communicates via HTTP** - Node.js uses [services/ml-client.js](../services/ml-client.js) wrapper
- **Services**: Recommendations (collaborative filtering), content analysis (sentiment, topics), image/video processing
- **Optional dependency** - Backend gracefully degrades if ML service unavailable

### Native Modules
- **C++ modules** in `native-modules/cpp/` - Video codec, image filters (compiled separately)
- **Kotlin modules** in `native-modules/android/` - RenderScript GPU-accelerated processing
- **Not auto-compiled** - Build manually if modifying native code

### Mobile Apps
- **Capacitor** wraps web app for iOS/Android
- **PWA-first** - Service worker in [public/service-worker.js](../public/service-worker.js)
- **Build commands**: `npx cap sync android/ios`, then `npx cap open android/ios`

## Critical Developer Workflows

### Starting Development
```bash
npm start                          # Node.js backend (port 3000)
python ml-service/app.py          # ML service (port 5000) - optional
./LAUNCH.sh                       # Shows all startup options
```

### Database Initialization
- **Auto-creates** on first run via [config/database.js](../config/database.js) `initDatabase()`
- **Schema changes** - Add migration in `migrateDatabase()` function
- **Switch to PostgreSQL** - Set `DB_TYPE=postgresql` in `.env` and configure `PG_*` variables

### Testing Features
- **See [TESTING_GUIDE.md](../TESTING_GUIDE.md)** for scenario-based test flows
- **Requires 2+ user accounts** - Test interactions (likes, comments, messages)
- **Video limit**: 120 seconds enforced client-side and in validation

## Project-Specific Conventions

### API Patterns
1. **All routes use `authMiddleware`** from [middleware/auth.js](../middleware/auth.js)
   - Extracts JWT from `Authorization: Bearer <token>` header OR `token` cookie
   - Sets `req.user = { userId, username }` for authenticated requests
   
2. **Database access** - ALWAYS use `const db = getDb()` from [config/database.js](../config/database.js)
   ```javascript
   const { getDb } = require('../config/database');
   const db = getDb();
   db.all('SELECT ...', [params], (err, rows) => { ... });
   ```

3. **Real-time events** - Access Socket.IO via `req.app.get('io')`
   ```javascript
   const io = req.app.get('io');
   io.to(`user-${userId}`).emit('notification:received', data);
   ```

4. **File uploads** - Use `upload.fields([...])` middleware from [middleware/upload.js](../middleware/upload.js)
   - Images: `upload.fields([{ name: 'images', maxCount: 10 }])`
   - Handles `req.files.images` array

### Frontend Architecture (Vanilla JS)
- **No build step** - Plain HTML/CSS/JS files in `public/`
- **Global utilities** in [public/js/app.js](../public/js/app.js): `apiRequest()`, `getToken()`, `requireAuth()`, `getCurrentUser()`
- **Socket.IO client** - Connect in app.js, emit `user:join` on connect
- **Instagram theme** - Use [public/js/instagram-theme.js](../public/js/instagram-theme.js) `igTheme.setTheme()` / `igTheme.toggle()`
- **CSS** - [public/css/instagram.css](../public/css/instagram.css) provides `:root` variables for dark/light themes

### Instagram-Style UI Patterns
- **Stories carousel** - Horizontal scroll with gradient rings (seen vs unseen)
- **Double-tap like** - Image elements get `dblclick` event listener
- **Bottom nav** - Fixed 50px with 5 icons (Home, Search, Create, Communities, Profile)
- **Top nav** - Fixed 60px with logo, search, and action icons
- **Modals** - Create post, 3-dot menu actions use fixed overlays

### Database Query Patterns
Always exclude blocked users and archived posts:
```javascript
// Example from routes/posts.js
LEFT JOIN blocked_users b1 ON (b1.blocker_id = ? AND b1.blocked_id = p.user_id)
LEFT JOIN blocked_users b2 ON (b2.blocker_id = p.user_id AND b2.blocked_id = ?)
WHERE p.is_archived = 0 AND b1.id IS NULL AND b2.id IS NULL
```

Include user engagement flags in post queries:
```javascript
(SELECT COUNT(*) FROM post_likes WHERE post_id = p.id AND user_id = ?) as user_has_liked,
(SELECT COUNT(*) FROM saved_posts WHERE post_id = p.id AND user_id = ?) as is_saved
```

### Socket.IO Event Naming
- **Pattern**: `resource:action` (e.g., `message:send`, `notification:received`, `user:join`)
- **User rooms**: `user-${userId}` for targeted broadcasts
- **Community rooms**: `community-${communityId}` for group chats
- **Common events**: `typing:start`, `typing:stop`, `call:initiate`, `call:answer`

## Key Integration Points

### ML Service Communication
```javascript
const mlClient = require('../services/ml-client');
const recommendations = await mlClient.getUserRecommendations(userId, 10);
// Handles timeouts, returns error object if service down
```

### Mobile-Specific Features
- **Push notifications** - Configured in [public/service-worker.js](../public/service-worker.js)
- **Native capabilities** - Check [capacitor.config.json](../capacitor.config.json) for available plugins
- **iOS build** - Requires Mac, see [IOS_BUILD.md](../IOS_BUILD.md)
- **Android build** - See [ANDROID_BUILD.md](../ANDROID_BUILD.md)

## Environment Configuration
Required `.env` variables:
- `JWT_SECRET` - **Must change in production**
- `DB_TYPE` - `sqlite` (dev) or `postgresql` (prod)
- `PYTHON_ML_SERVICE_URL` - Defaults to `http://localhost:5000`
- `PORT` - Defaults to 3000

## Documentation Map
- [ARCHITECTURE.md](../ARCHITECTURE.md) - System diagrams and data flows
- [COMPLETE_PROJECT_SUMMARY.md](../COMPLETE_PROJECT_SUMMARY.md) - Feature implementation status
- [QUICK_START.md](../QUICK_START.md) - UI component layouts and screenshots
- [TESTING_GUIDE.md](../TESTING_GUIDE.md) - Test scenarios with verification steps
- [DEPLOYMENT_GUIDE.md](../DEPLOYMENT_GUIDE.md) - Production deployment (all platforms)
