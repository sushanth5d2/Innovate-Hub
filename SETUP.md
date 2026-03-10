# Innovate Hub - Codespace Setup Guide

Complete setup guide for getting the project running in a new GitHub Codespace or development environment.

## Quick Start (5 Steps)

```bash
# 1. Install dependencies
npm install

# 2. Copy environment file
cp .env.example .env

# 3. Start with SQLite (simplest - no database setup needed)
npm run dev

# 4. Open in browser
# The app runs on port 3000 - Codespace will auto-forward it
```

That's it for basic development. Read on for PostgreSQL, Android builds, ML service, and more.

---

## Table of Contents

- [Environment Variables](#environment-variables)
- [Database Setup](#database-setup)
- [Starting the Server](#starting-the-server)
- [ML Service (Optional)](#ml-service-optional)
- [Android APK Build](#android-apk-build)
- [Docker Setup](#docker-setup)
- [Services & Ports](#services--ports)
- [Admin Account](#admin-account)
- [Push Notifications](#push-notifications)
- [Project Structure](#project-structure)
- [Troubleshooting](#troubleshooting)

---

## Environment Variables

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

### Required Variables

| Variable | Description | Example |
|---|---|---|
| `JWT_SECRET` | JWT signing key (change in production!) | Generate with: `node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"` |

### Database Variables

| Variable | Default | Description |
|---|---|---|
| `DB_TYPE` | `sqlite` | `sqlite` for dev, `postgresql` for prod |
| `SQLITE_DB_PATH` | `./database/innovate.db` | SQLite file location |
| `PG_HOST` | — | PostgreSQL host (e.g. `localhost`) |
| `PG_PORT` | `5432` | PostgreSQL port |
| `PG_USER` | — | PostgreSQL user (e.g. `innovate_hub`) |
| `PG_PASSWORD` | — | PostgreSQL password |
| `PG_DATABASE` | — | PostgreSQL database name (e.g. `innovate_hub`) |

### Server Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | Server port |
| `NODE_ENV` | `development` | `development` or `production` |
| `ALLOWED_ORIGINS` | `*` | CORS origins (comma-separated) |
| `MAX_FILE_SIZE` | `10485760` | Upload size limit (bytes, default 10MB) |
| `UPLOAD_DIR` | `./uploads` | Upload directory |

### Admin Account

| Variable | Default | Description |
|---|---|---|
| `ADMIN_EMAIL` | — | Admin login email |
| `ADMIN_PASSWORD` | — | Admin login password |
| `ADMIN_USERNAME` | — | Admin display name |

### Optional Services

| Variable | Default | Description |
|---|---|---|
| `REDIS_ENABLED` | — | Set `true` to enable Redis caching |
| `REDIS_URL` | `redis://localhost:6379` | Redis connection URL |
| `PYTHON_ML_SERVICE_URL` | `http://localhost:5000` | ML microservice URL |
| `OLLAMA_ENABLED` | — | Set `true` for local Ollama AI |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Ollama server URL |

### AI API Keys (all optional)

`GROQ_API_KEY`, `GOOGLE_AI_API_KEY`, `HUGGINGFACE_API_KEY`, `MISTRAL_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`

---

## Database Setup

### Option 1: SQLite (Simplest - Recommended for Dev)

No setup needed. Set `DB_TYPE=sqlite` in `.env` (this is the default). The database file auto-creates at `./database/innovate.db` on first run.

### Option 2: PostgreSQL

1. **Install PostgreSQL** (if not already installed):
   ```bash
   sudo apt update && sudo apt install -y postgresql postgresql-contrib
   sudo service postgresql start
   ```

2. **Create database and user**:
   ```bash
   sudo -u postgres psql -c "CREATE USER innovate_hub WITH PASSWORD 'your_password';"
   sudo -u postgres psql -c "CREATE DATABASE innovate_hub OWNER innovate_hub;"
   sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE innovate_hub TO innovate_hub;"
   ```

3. **Load schema**:
   ```bash
   PGPASSWORD='your_password' psql -h localhost -U innovate_hub -d innovate_hub -f db/postgres-schema.sql
   # Run twice if you get foreign key errors on first run
   PGPASSWORD='your_password' psql -h localhost -U innovate_hub -d innovate_hub -f db/postgres-schema.sql
   ```

4. **Update `.env`**:
   ```env
   DB_TYPE=postgresql
   PG_HOST=localhost
   PG_PORT=5432
   PG_USER=innovate_hub
   PG_PASSWORD=your_password
   PG_DATABASE=innovate_hub
   ```

---

## Starting the Server

### Development (with auto-reload)
```bash
npm run dev
# Uses nodemon, watches for file changes
```

### Production
```bash
npm run prod
# Sets NODE_ENV=production
```

### Using start.sh
```bash
chmod +x start.sh
./start.sh dev          # SQLite + nodemon
./start.sh prod         # PostgreSQL + node
./start.sh pm2-dev      # PM2 watch mode
./start.sh pm2-prod     # PM2 clustered production
```

The server starts on **port 3000** by default.

---

## ML Service (Optional)

The Python ML microservice provides recommendations, content analysis, and image/video processing. The backend gracefully degrades if it's unavailable.

### Setup
```bash
cd ml-service
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python app.py
```

Or use the helper script:
```bash
chmod +x start-ml-service.sh
./start-ml-service.sh
```

The ML service runs on **port 5000**. Verify: `curl http://localhost:5000/health`

### Requirements
- Python 3.11+
- System packages (for OpenCV): `sudo apt install -y libgl1 libglib2.0-0`

---

## Android APK Build

### Prerequisites

1. **Install Java 21**:
   ```bash
   sudo apt update && sudo apt install -y openjdk-21-jdk
   export JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64
   ```

2. **Update Capacitor server URL** in `capacitor.config.json`:
   ```json
   {
     "server": {
       "url": "https://YOUR-CODESPACE-URL-3000.app.github.dev",
       "cleartext": true
     }
   }
   ```
   Replace with your actual codespace forwarded URL for port 3000.

### Build Steps

```bash
# Sync web assets to Android project
npx cap sync android

# Build debug APK
cd android
./gradlew assembleDebug

# APK location:
# android/app/build/outputs/apk/debug/app-debug.apk
```

### Build Config
- **App ID**: `com.innovatehub.app`
- **Min SDK**: 24 (Android 7.0)
- **Target SDK**: 36
- **Gradle**: 8.14.3
- **Android Gradle Plugin**: 8.13.0

---

## Docker Setup

Run the full stack with Docker Compose:

```bash
# Start all services (app, postgres, redis, ml-service, nginx)
npm run docker:up
# or
docker compose up --build -d

# View logs
npm run docker:logs

# Stop
npm run docker:down
```

### Docker Services

| Service | Port | Description |
|---|---|---|
| `app` | 3000 | Node.js backend |
| `postgres` | 5432 | PostgreSQL 16 (auto-loads schema) |
| `redis` | 6379 | Redis 7 (AOF persistence) |
| `ml-service` | 5000 | Python Flask ML service |
| `nginx` | 80, 443 | Reverse proxy |

> **Note**: Nginx requires `nginx/nginx.conf` to be created first.

---

## Services & Ports

| Service | Port | Required |
|---|---|---|
| Node.js Backend | 3000 | Yes |
| PostgreSQL | 5432 | Only if `DB_TYPE=postgresql` |
| ML Service (Flask) | 5000 | No (optional) |
| Redis | 6379 | No (optional) |
| Ollama | 11434 | No (optional) |

---

## Admin Account

Set admin credentials in `.env`:
```env
ADMIN_EMAIL=admin@innovatehub.com
ADMIN_PASSWORD=YourSecurePassword
ADMIN_USERNAME=admin
```

Access admin panel at `/admin` after logging in with admin credentials.

---

## Push Notifications

Push notifications use Firebase Cloud Messaging (FCM) for Android.

### Setup (Optional)
1. Create a Firebase project at [console.firebase.google.com](https://console.firebase.google.com)
2. Add an Android app with package name `com.innovatehub.app`
3. Download `google-services.json` → place in `android/app/`
4. Generate a service account key → save as `config/firebase-service-account.json`
5. Set `FIREBASE_SERVICE_ACCOUNT_PATH=./config/firebase-service-account.json` in `.env`

Without Firebase config, push notifications are disabled but the app works normally.

---

## Project Structure

```
├── server.js                # Main Express server + Socket.IO
├── config/
│   ├── database.js          # DB initialization, migrations, SQLite/PostgreSQL
│   ├── cache.js             # Redis cache wrapper
│   └── logger.js            # Pino logger config
├── middleware/
│   ├── auth.js              # JWT authentication
│   ├── upload.js            # Multer file uploads
│   └── performance.js       # Request timing
├── routes/                  # 19 API route modules
│   ├── auth.js              # Login, register, password reset
│   ├── posts.js             # Feed, likes, comments
│   ├── messages.js          # DMs, group messages
│   ├── communities.js       # Community CRUD
│   ├── events.js            # Events management
│   ├── social-service.js    # Donation marketplace
│   └── ...
├── services/                # Business logic
│   ├── push-service.js      # Firebase push notifications
│   ├── ai-provider.js       # Multi-provider AI integration
│   ├── ml-client.js         # ML service HTTP client
│   └── ...
├── public/                  # Frontend (vanilla JS, no build step)
│   ├── css/                 # Stylesheets
│   ├── js/                  # Client-side JavaScript
│   └── *.html               # Page templates
├── ml-service/              # Python ML microservice
│   ├── app.py               # Flask app
│   ├── requirements.txt     # Python dependencies
│   └── services/            # ML modules
├── android/                 # Capacitor Android project
├── db/
│   └── postgres-schema.sql  # PostgreSQL schema (73 tables)
├── .env.example             # Environment template
├── docker-compose.yml       # Docker stack
├── Dockerfile               # Node.js container
├── start.sh                 # Multi-mode startup script
├── LAUNCH.sh                # Welcome banner
└── capacitor.config.json    # Mobile app config
```

---

## Troubleshooting

### "Module not found" errors
```bash
npm install
```

### SQLite errors on fresh start
The database auto-creates. If corrupted, delete and restart:
```bash
rm -f database/innovate.db
npm run dev
```

### PostgreSQL connection refused
```bash
sudo service postgresql start
# Verify it's running:
sudo service postgresql status
```

### Android build fails with "Unsupported class file major version"
You need Java 21:
```bash
sudo apt install -y openjdk-21-jdk
export JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64
```

### Capacitor sync fails
```bash
npm install @capacitor/core @capacitor/cli @capacitor/android
npx cap sync android
```

### ML service won't start
```bash
sudo apt install -y python3-venv libgl1 libglib2.0-0
cd ml-service && python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt
python app.py
```

### Port already in use
```bash
# Find and kill process on port 3000
lsof -ti:3000 | xargs kill -9
```
