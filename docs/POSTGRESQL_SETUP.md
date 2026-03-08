# PostgreSQL Setup Guide (GitHub Codespaces / Ubuntu)

This guide covers installing, configuring, and running PostgreSQL for the Innovate Hub project.


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



## Prerequisites

- Ubuntu-based environment (GitHub Codespaces, WSL, or native Ubuntu)
- `sudo` access

## 1. Install PostgreSQL

```bash
sudo apt-get update -qq --allow-insecure-repositories
sudo apt-get install -y postgresql postgresql-contrib
```

## 2. Start PostgreSQL

```bash
sudo pg_ctlcluster 16 main start
```

Verify it's running:

```bash
pg_isready
# Expected: /var/run/postgresql:5432 - accepting connections
```

> **Note:** In GitHub Codespaces, PostgreSQL does not auto-start on container restart. You must run `sudo pg_ctlcluster 16 main start` each time the container boots.

## 3. Create Database and User

Run the following commands to create the `innovate_hub` user and database:

```bash
sudo su - postgres -c "psql -c \"CREATE USER innovate_hub WITH PASSWORD 'Sushanth@123';\""
sudo su - postgres -c "psql -c \"CREATE DATABASE innovate_hub OWNER innovate_hub;\""
sudo su - postgres -c "psql -c \"GRANT ALL PRIVILEGES ON DATABASE innovate_hub TO innovate_hub;\""
sudo su - postgres -c "psql -d innovate_hub -c \"GRANT ALL ON SCHEMA public TO innovate_hub;\""
```

## 4. Environment Configuration

Ensure your `.env` file has these values:

```env
DB_TYPE=postgresql
PG_HOST=localhost
PG_PORT=5432
PG_USER=innovate_hub
PG_PASSWORD=Sushanth@123
PG_DATABASE=innovate_hub
```

## 5. Verify Connection

Test the connection manually:

```bash
PGPASSWORD='Sushanth@123' psql -h localhost -U innovate_hub -d innovate_hub -c "SELECT current_user, current_database();"
```

Expected output:

```
 current_user | current_database
--------------+------------------
 innovate_hub | innovate_hub
```

## 6. Start the Application

```bash
npm start
```

The server will connect to PostgreSQL and auto-create all required tables on first run.

## Troubleshooting

### `ECONNREFUSED ::1:5432` or `ECONNREFUSED 127.0.0.1:5432`

PostgreSQL is not running. Start it:

```bash
sudo pg_ctlcluster 16 main start
```

### `password authentication failed for user "innovate_hub"`

The user doesn't exist or the password is wrong. Recreate it:

```bash
sudo su - postgres -c "psql -c \"DROP USER IF EXISTS innovate_hub;\""
sudo su - postgres -c "psql -c \"CREATE USER innovate_hub WITH PASSWORD 'Sushanth@123';\""
```

### `database "innovate_hub" does not exist`

Create the database:

```bash
sudo su - postgres -c "psql -c \"CREATE DATABASE innovate_hub OWNER innovate_hub;\""
```

### `permission denied for schema public`

Grant schema access:

```bash
sudo su - postgres -c "psql -d innovate_hub -c \"GRANT ALL ON SCHEMA public TO innovate_hub;\""
```

### "Schema statement failed" messages on startup

This typically means the tables already exist (safe to ignore) or PostgreSQL isn't reachable (see `ECONNREFUSED` fix above).

## Quick Start (Copy-Paste)

Run everything at once after a fresh container start:

```bash
sudo pg_ctlcluster 16 main start
npm start
```

First-time setup (run once):

```bash
sudo apt-get update -qq --allow-insecure-repositories
sudo apt-get install -y postgresql postgresql-contrib
sudo pg_ctlcluster 16 main start
sudo su - postgres -c "psql -c \"CREATE USER innovate_hub WITH PASSWORD 'Sushanth@123';\""
sudo su - postgres -c "psql -c \"CREATE DATABASE innovate_hub OWNER innovate_hub;\""
sudo su - postgres -c "psql -c \"GRANT ALL PRIVILEGES ON DATABASE innovate_hub TO innovate_hub;\""
sudo su - postgres -c "psql -d innovate_hub -c \"GRANT ALL ON SCHEMA public TO innovate_hub;\""
npm start
```
