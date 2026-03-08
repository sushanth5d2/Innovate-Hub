# Innovate Hub — Full Setup Guide

> Complete guide for setting up the Innovate Hub application from scratch on Ubuntu/Debian (including GitHub Codespaces).

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Fix Yarn GPG Key (if needed)](#2-fix-yarn-gpg-key-if-needed)
3. [Install & Start PostgreSQL](#3-install--start-postgresql)
4. [Create Database User & Database](#4-create-database-user--database)
5. [Initialize the Schema](#5-initialize-the-schema)
6. [Install ffmpeg (Media Processing)](#6-install-ffmpeg-media-processing)
7. [Configure Environment Variables](#7-configure-environment-variables)
8. [Install Node.js Dependencies](#8-install-nodejs-dependencies)
9. [Start the Application](#9-start-the-application)
10. [Verify Everything Works](#10-verify-everything-works)
11. [Troubleshooting](#11-troubleshooting)
12. [Quick Reference Commands](#12-quick-reference-commands)

---

Easy process 
If you see this warning when running `apt-get update`:
# 1. Fix Yarn GPG key (avoids apt warnings)
curl -sS https://dl.yarnpkg.com/debian/pubkey.gpg | sudo gpg --dearmor --yes -o /usr/share/keyrings/yarn-archive-keyring.gpg

# 2. Install PostgreSQL & ffmpeg
sudo apt-get update -qq && sudo apt-get install -y postgresql postgresql-contrib ffmpeg

# 3. Start PostgreSQL
sudo pg_ctlcluster 16 main start

# 4. Create DB user & database
sudo su - postgres -c "psql -c \"CREATE USER innovate_hub WITH PASSWORD 'Sushanth@123' CREATEDB;\""
sudo su - postgres -c "psql -c \"CREATE DATABASE innovate_hub OWNER innovate_hub;\""

# 5. Load schema (run 3 times for FK dependencies)
for i in 1 2 3; do
  PGPASSWORD='Sushanth@123' psql -h localhost -U innovate_hub -d innovate_hub -f db/postgres-schema.sql 2>&1 | grep -c "CREATE TABLE"
done

# 6. Copy env file
cp .env.example .env
# Then edit .env: set DB_TYPE=postgresql, PG_PASSWORD, and generate a JWT_SECRET

# 7. Install deps & start
npm install
npm start




## 1. Prerequisites

- **OS**: Ubuntu 24.04 / Debian-based (or GitHub Codespaces)
- **Node.js**: v18+ (pre-installed in Codespaces)
- **npm**: v9+ (comes with Node.js)
- **sudo access** on the machine

Check versions:
```bash
node -v    # Should be v18+
npm -v     # Should be v9+
```

---

## 2. Fix Yarn GPG Key (if needed)

If you see this warning when running `apt-get update`:
```
W: GPG error: https://dl.yarnpkg.com/debian stable InRelease:
The following signatures couldn't be verified because the public key
is not available: NO_PUBKEY 62D54FD4003F6525
```

**Fix**: Download and install the correct GPG key in dearmored (binary) format:
```bash
curl -sS https://dl.yarnpkg.com/debian/pubkey.gpg \
  | sudo gpg --dearmor --yes -o /usr/share/keyrings/yarn-archive-keyring.gpg
```

**Why this happens**: The Yarn apt source at `/etc/apt/sources.list.d/yarn.list` references a `signed-by` keyring file. If that file is missing, empty, or in the wrong format (ASCII instead of binary), apt cannot verify the repository signature.

**Verify the fix**:
```bash
sudo apt-get update -qq 2>&1 | grep -i yarn
# Should produce NO output (no warnings)
```

---

## 3. Install & Start PostgreSQL

### Install PostgreSQL 16
```bash
sudo apt-get update -qq
sudo apt-get install -y postgresql postgresql-contrib
```

### Start the PostgreSQL Service
In Codespaces/containers, the service doesn't auto-start. Use:
```bash
sudo pg_ctlcluster 16 main start
```

### Verify PostgreSQL is Running
```bash
pg_isready
# Expected: /var/run/postgresql:5432 - accepting connections
```

> **Note**: On every Codespace restart, you need to start PostgreSQL again:
> ```bash
> sudo pg_ctlcluster 16 main start
> ```

---

## 4. Create Database User & Database

### Create the User
```bash
sudo su - postgres -c "psql -c \"CREATE USER innovate_hub WITH PASSWORD 'Sushanth@123' CREATEDB;\""
```

If the user already exists, set/reset the password:
```bash
sudo su - postgres -c "psql -c \"ALTER USER innovate_hub WITH PASSWORD 'Sushanth@123';\""
```

### Create the Database
```bash
sudo su - postgres -c "psql -c \"CREATE DATABASE innovate_hub OWNER innovate_hub;\""
```

### Verify the Connection
```bash
PGPASSWORD='Sushanth@123' psql -h localhost -U innovate_hub -d innovate_hub -c "SELECT 1 AS test;"
```
Expected output:
```
 test
------
    1
(1 row)
```

---

## 5. Initialize the Schema

The schema file (`db/postgres-schema.sql`) contains 70 tables in alphabetical order. Due to foreign key dependencies between tables, you need to run it **3 times** to create all tables:

```bash
# Pass 1: Creates tables with no FK dependencies (~37 tables)
PGPASSWORD='Sushanth@123' psql -h localhost -U innovate_hub -d innovate_hub \
  -f db/postgres-schema.sql 2>&1 | grep -c "CREATE TABLE"

# Pass 2: Creates tables whose FK deps now exist (~28 more)
PGPASSWORD='Sushanth@123' psql -h localhost -U innovate_hub -d innovate_hub \
  -f db/postgres-schema.sql 2>&1 | grep -c "CREATE TABLE"

# Pass 3: Creates remaining tables (~5 more)
PGPASSWORD='Sushanth@123' psql -h localhost -U innovate_hub -d innovate_hub \
  -f db/postgres-schema.sql 2>&1 | grep -c "CREATE TABLE"
```

### Verify All 70 Tables Exist
```bash
PGPASSWORD='Sushanth@123' psql -h localhost -U innovate_hub -d innovate_hub \
  -c "SELECT COUNT(*) FROM pg_tables WHERE schemaname='public';"
```
Expected: `70`

> **Note**: The application also auto-creates tables on startup via `createTablesPostgres()` in `config/database.js`. If tables already exist, it simply skips them ("IF NOT EXISTS"). Pre-creating with psql avoids the "Schema statement failed" warnings on first boot.

---

## 6. Install ffmpeg (Media Processing)

ffmpeg is needed for video/audio processing (thumbnails, codec detection, etc.):
```bash
sudo apt-get install -y ffmpeg
```

Verify:
```bash
ffmpeg -version | head -1
# Should show: ffmpeg version 6.x ...
```

Without ffmpeg the app still works, but video features are limited. The startup log will show:
- `[AI Media] ffmpeg available: true` (with ffmpeg)
- `[AI Media] ffmpeg available: false` (without ffmpeg)

---

## 7. Configure Environment Variables

The `.env` file is already configured. Key settings for PostgreSQL:

```env
# Database
DB_TYPE=postgresql
PG_HOST=localhost
PG_PORT=5432
PG_USER=innovate_hub
PG_PASSWORD=Sushanth@123
PG_DATABASE=innovate_hub

# Server
PORT=3000
NODE_ENV=production
```

If you need to change the password, update **both**:
1. The `.env` file (`PG_PASSWORD=...`)
2. The PostgreSQL user: `sudo su - postgres -c "psql -c \"ALTER USER innovate_hub WITH PASSWORD 'NEW_PASSWORD';\""`

---

## 8. Install Node.js Dependencies

```bash
cd /workspaces/Innovate-Hub
npm install
```

---

## 9. Start the Application

```bash
npm start
```

### Expected Clean Startup Output
```
[AI Media] ffmpeg available: true
Connected to PostgreSQL database
Redis caching is disabled
{"level":"info","port":"3000","env":"production","msg":"Server running on port 3000"}
PostgreSQL tables ensured (70 created in 1 passes, 0 remaining)
[Groq] Loaded 14 free models
[Pollinations] Loaded 1 free models (default: openai-fast)
[Mistral] Loaded 40 free models
```

Key indicators of a healthy start:
- `Connected to PostgreSQL database` — DB connection works
- `PostgreSQL tables ensured (70 created in 1 passes, 0 remaining)` — All tables exist
- `Server running on port 3000` — App is serving
- No "Schema statement failed" messages

---

## 10. Verify Everything Works

### Check Server is Responding
```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/
# Expected: 200
```

### Check Database Tables
```bash
PGPASSWORD='Sushanth@123' psql -h localhost -U innovate_hub -d innovate_hub \
  -c "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename;" | head -20
```

### Open in Browser
In Codespaces, port 3000 is automatically forwarded. Open the "Ports" tab and click the globe icon next to port 3000.

---

## 11. Troubleshooting

### "Schema statement failed:" (70 remaining)
**Cause**: Tables don't exist yet and the multi-pass logic couldn't create them.
**Fix**: Run the schema manually 3 times (see [Step 5](#5-initialize-the-schema)), then restart the app.

### "PostgreSQL pool error: Connection refused"
**Cause**: PostgreSQL is not running.
**Fix**:
```bash
sudo pg_ctlcluster 16 main start
pg_isready  # Confirm it's accepting connections
```

### "password authentication failed for user innovate_hub"
**Cause**: Password mismatch between `.env` and PostgreSQL.
**Fix**:
```bash
sudo su - postgres -c "psql -c \"ALTER USER innovate_hub WITH PASSWORD 'Sushanth@123';\""
```

### "FATAL: database 'innovate_hub' does not exist"
**Fix**:
```bash
sudo su - postgres -c "psql -c \"CREATE DATABASE innovate_hub OWNER innovate_hub;\""
```

### GPG key warning for Yarn repository
**Fix**:
```bash
curl -sS https://dl.yarnpkg.com/debian/pubkey.gpg \
  | sudo gpg --dearmor --yes -o /usr/share/keyrings/yarn-archive-keyring.gpg
```

### "Redis caching is disabled"
This is **normal** — Redis is optional. The app works fine without it.

### "[AI Media] ffmpeg available: false"
**Fix**: `sudo apt-get install -y ffmpeg`

---

## 12. Quick Reference Commands

| Task                          | Command                                              |
|-------------------------------|------------------------------------------------------|
| Start PostgreSQL              | `sudo pg_ctlcluster 16 main start`                   |
| Check PostgreSQL status       | `pg_isready`                                         |
| Start the app                 | `npm start`                                          |
| Connect to database (psql)    | `PGPASSWORD='Sushanth@123' psql -h localhost -U innovate_hub -d innovate_hub` |
| Count tables                  | `... -c "SELECT COUNT(*) FROM pg_tables WHERE schemaname='public';"` |
| Run schema (create tables)    | `... -f db/postgres-schema.sql`                      |
| Fix Yarn GPG key              | `curl -sS https://dl.yarnpkg.com/debian/pubkey.gpg \| sudo gpg --dearmor --yes -o /usr/share/keyrings/yarn-archive-keyring.gpg` |
| Stop PostgreSQL               | `sudo pg_ctlcluster 16 main stop`                    |
| Restart PostgreSQL            | `sudo pg_ctlcluster 16 main restart`                 |

---

## Codespace Restart Checklist

After a Codespace restarts, run these commands before starting the app:

```bash
# 1. Start PostgreSQL
sudo pg_ctlcluster 16 main start

# 2. Verify DB connection
pg_isready

# 3. Start the app
cd /workspaces/Innovate-Hub
npm start
```

---

## Changes Made During Setup (March 8, 2026)

### 1. Yarn GPG Key Fix
- **File changed**: `/usr/share/keyrings/yarn-archive-keyring.gpg`
- **What**: Re-downloaded Yarn's public GPG key in binary (dearmored) format
- **Why**: The apt repository signature verification was failing because the keyring file was missing or in wrong format
- **Command**: `curl -sS https://dl.yarnpkg.com/debian/pubkey.gpg | sudo gpg --dearmor --yes -o /usr/share/keyrings/yarn-archive-keyring.gpg`

### 2. PostgreSQL Installation
- **Package**: `postgresql postgresql-contrib` (version 16)
- **Service start**: `sudo pg_ctlcluster 16 main start`
- **Config file**: `/etc/postgresql/16/main/pg_hba.conf` (default — uses `scram-sha-256` for localhost TCP connections)

### 3. Database & User Creation
- **User**: `innovate_hub` with password `Sushanth@123` and `CREATEDB` privilege
- **Database**: `innovate_hub` owned by `innovate_hub`
- **Auth method**: `scram-sha-256` over TCP (localhost:5432)

### 4. Schema Initialization
- **Schema file**: `db/postgres-schema.sql` (70 tables, auto-generated from SQLite schema)
- **Required 3 passes** due to alphabetical ordering and FK dependencies between tables
- After initialization: all 70 tables created successfully

### 5. ffmpeg Installation
- **Package**: `ffmpeg`
- **Purpose**: Video/audio processing support for the AI Media features

### No Application Code Changes
All fixes were infrastructure/system-level. No changes were made to the application source code.
