# Deployment Checklist - Enhanced Home Feed

## Pre-Deployment Verification

### ✅ Code Quality
- [ ] All files saved and committed
- [ ] No syntax errors (run `npm run lint`)
- [ ] All console.log statements removed or converted to proper logging
- [ ] Error handling implemented for all async operations
- [ ] Input validation on all forms

### ✅ Database
- [ ] All tables created successfully
- [ ] Foreign keys configured correctly
- [ ] Indexes added for performance:
  ```sql
  CREATE INDEX idx_post_likes_post_id ON post_likes(post_id);
  CREATE INDEX idx_post_likes_user_id ON post_likes(user_id);
  CREATE INDEX idx_post_comments_post_id ON post_comments(post_id);
  CREATE INDEX idx_instant_meetings_post_id ON instant_meetings(post_id);
  CREATE INDEX idx_posts_created_at ON posts(created_at DESC);
  ```
- [ ] Migration scripts ready for production database
- [ ] Backup strategy in place

### ✅ Security
- [ ] JWT authentication working on all endpoints
- [ ] SQL injection prevention (parameterized queries)
- [ ] XSS protection (input sanitization)
- [ ] CSRF tokens implemented
- [ ] File upload validation (type, size, content)
- [ ] Rate limiting configured
- [ ] HTTPS enabled (production)
- [ ] Environment variables secured (not in git)

### ✅ File Uploads
- [ ] Upload directory exists and has write permissions
- [ ] File size limits configured (100MB)
- [ ] Allowed file types validated
- [ ] Video duration validation working
- [ ] File cleanup job scheduled (old/orphaned files)
- [ ] CDN or cloud storage configured (optional)

### ✅ Real-Time Features
- [ ] Socket.IO server running
- [ ] WebSocket connections stable
- [ ] Notification delivery tested
- [ ] Reconnection logic working
- [ ] Heartbeat mechanism active

### ✅ Performance
- [ ] Database queries optimized
- [ ] N+1 query problems resolved
- [ ] Image compression enabled
- [ ] Video transcoding configured (optional)
- [ ] Caching strategy implemented
- [ ] CDN configured for static assets

### ✅ Testing
- [ ] All test scenarios completed (see TESTING_GUIDE.md)
- [ ] Unit tests passing
- [ ] Integration tests passing
- [ ] Manual QA completed
- [ ] Browser compatibility verified
- [ ] Mobile responsiveness tested
- [ ] Load testing performed

### ✅ Documentation
- [ ] API endpoints documented
- [ ] Database schema documented
- [ ] User guide created
- [ ] Admin guide created
- [ ] Troubleshooting guide available

---

## Deployment Steps

### Step 1: Environment Configuration

1. **Create production .env file**:
```env
NODE_ENV=production
PORT=3000
JWT_SECRET=<strong-random-secret>
DATABASE_TYPE=postgresql
DATABASE_URL=postgresql://user:password@host:5432/innovate_hub
UPLOAD_DIR=/var/www/innovate-hub/uploads
MAX_FILE_SIZE=104857600
```

2. **Configure PostgreSQL** (production):
```bash
# Install PostgreSQL
sudo apt-get install postgresql postgresql-contrib

# Create database
sudo -u postgres createdb innovate_hub

# Run migrations
npm run migrate:production
```

### Step 2: Build and Deploy

1. **Install dependencies**:
```bash
npm ci --production
```

2. **Build frontend assets** (if applicable):
```bash
npm run build
```

3. **Set up process manager** (PM2):
```bash
npm install -g pm2
pm2 start server.js --name innovate-hub
pm2 save
pm2 startup
```

### Step 3: Nginx Configuration

1. **Create Nginx config** (`/etc/nginx/sites-available/innovate-hub`):
```nginx
server {
    listen 80;
    server_name innovate-hub.com www.innovate-hub.com;

    # Redirect to HTTPS
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name innovate-hub.com www.innovate-hub.com;

    # SSL certificates
    ssl_certificate /etc/letsencrypt/live/innovate-hub.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/innovate-hub.com/privkey.pem;

    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;

    # Gzip compression
    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml application/xml+rss text/javascript;

    # File upload size
    client_max_body_size 100M;

    # Static files
    location /uploads/ {
        alias /var/www/innovate-hub/uploads/;
        expires 30d;
        add_header Cache-Control "public, immutable";
    }

    location /css/ {
        alias /var/www/innovate-hub/public/css/;
        expires 7d;
    }

    location /js/ {
        alias /var/www/innovate-hub/public/js/;
        expires 7d;
    }

    # Proxy to Node.js
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # WebSocket support (Socket.IO)
    location /socket.io/ {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

2. **Enable site**:
```bash
sudo ln -s /etc/nginx/sites-available/innovate-hub /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

### Step 4: SSL Certificate (Let's Encrypt)

```bash
sudo apt-get install certbot python3-certbot-nginx
sudo certbot --nginx -d innovate-hub.com -d www.innovate-hub.com
```

### Step 5: Database Migration

1. **Export SQLite data** (development):
```bash
sqlite3 database.sqlite .dump > dump.sql
```

2. **Import to PostgreSQL** (production):
```bash
psql innovate_hub < dump.sql
```

3. **Run new migrations**:
```bash
psql innovate_hub -f migrations/add_new_tables.sql
```

### Step 6: File Permissions

```bash
sudo chown -R www-data:www-data /var/www/innovate-hub
sudo chmod -R 755 /var/www/innovate-hub
sudo chmod -R 775 /var/www/innovate-hub/uploads
```

### Step 7: Monitoring Setup

1. **Install monitoring tools**:
```bash
npm install -g pm2
pm2 install pm2-logrotate
```

2. **Configure logging**:
```javascript
// In server.js
const winston = require('winston');
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  transports: [
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' })
  ]
});
```

3. **Set up health check endpoint**:
```javascript
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date() });
});
```

### Step 8: Scheduled Jobs (Cron)

1. **Create cleanup script** (`cleanup.js`):
```javascript
// Delete expired stories
const deleteExpiredStories = async () => {
  await db.run('DELETE FROM posts WHERE is_story = 1 AND expires_at < ?', [new Date().toISOString()]);
};

// Delete orphaned files
const deleteOrphanedFiles = async () => {
  // Implementation
};
```

2. **Add to crontab**:
```bash
# Edit crontab
crontab -e

# Add jobs
0 * * * * node /var/www/innovate-hub/cleanup.js # Every hour
0 2 * * * node /var/www/innovate-hub/backup.js  # Daily at 2 AM
```

---

## Post-Deployment Verification

### ✅ Smoke Tests

1. **Homepage loads**:
```bash
curl -I https://innovate-hub.com
# Expected: 200 OK
```

2. **API health check**:
```bash
curl https://innovate-hub.com/health
# Expected: {"status":"ok","timestamp":"..."}
```

3. **WebSocket connection**:
- Open browser console
- Check for Socket.IO connection message
- Send test notification

4. **Database connection**:
```bash
pm2 logs innovate-hub | grep "database"
# Expected: "Connected to PostgreSQL database"
```

5. **File uploads**:
- Create a post with image
- Verify file saved to upload directory
- Verify image displays correctly

### ✅ Feature Verification

- [ ] User registration works
- [ ] User login works
- [ ] Post creation (text, image, video)
- [ ] Story creation
- [ ] Like/unlike functionality
- [ ] Comment system
- [ ] Share (copy link)
- [ ] Save/bookmark
- [ ] 3-dot menu actions (all)
- [ ] Gentle reminders
- [ ] Instant meetings
- [ ] Real-time notifications
- [ ] Mobile responsiveness

### ✅ Performance Checks

```bash
# Check server response time
curl -o /dev/null -s -w 'Total: %{time_total}s\n' https://innovate-hub.com

# Check database queries
psql innovate_hub -c "SELECT query, calls, total_time FROM pg_stat_statements ORDER BY total_time DESC LIMIT 10;"

# Check server resources
pm2 monit
```

---

## Rollback Plan

If issues occur:

1. **Immediate rollback**:
```bash
pm2 stop innovate-hub
git checkout <previous-commit>
pm2 restart innovate-hub
```

2. **Database rollback**:
```bash
psql innovate_hub < backup_<timestamp>.sql
```

3. **Notify users**:
- Post status update
- Send email notification
- Update social media

---

## Monitoring & Alerts

### Set up alerts for:

- [ ] Server downtime
- [ ] High error rates (> 5% of requests)
- [ ] Slow response times (> 2 seconds)
- [ ] Database connection failures
- [ ] Disk space low (< 20% free)
- [ ] High memory usage (> 80%)
- [ ] Failed file uploads

### Monitoring tools:

- **Uptime monitoring**: UptimeRobot, Pingdom
- **Application monitoring**: PM2, New Relic
- **Error tracking**: Sentry
- **Analytics**: Google Analytics, Mixpanel

---

## Backup Strategy

### Automated backups:

1. **Database backups** (daily):
```bash
#!/bin/bash
# /var/www/innovate-hub/backup.sh
DATE=$(date +%Y%m%d_%H%M%S)
pg_dump innovate_hub > /backups/db_$DATE.sql
gzip /backups/db_$DATE.sql

# Keep only last 7 days
find /backups -name "db_*.sql.gz" -mtime +7 -delete
```

2. **File backups** (weekly):
```bash
tar -czf /backups/uploads_$DATE.tar.gz /var/www/innovate-hub/uploads
```

3. **Off-site backups**: Configure AWS S3, Google Cloud Storage, or similar

---

## Contact Information

**Technical Support**: tech@innovate-hub.com  
**Emergency Hotline**: +1-XXX-XXX-XXXX  
**Status Page**: status.innovate-hub.com

---

## Post-Launch Checklist

### Week 1:
- [ ] Monitor error logs daily
- [ ] Review user feedback
- [ ] Check performance metrics
- [ ] Verify all backups running
- [ ] Test disaster recovery

### Week 2-4:
- [ ] Analyze usage patterns
- [ ] Optimize slow queries
- [ ] Review security logs
- [ ] Plan feature updates
- [ ] User satisfaction survey

---

**Deployment Date**: ___________  
**Deployed By**: ___________  
**Version**: 2.0  
**Status**: ⚠️ Ready for Deployment

---

Good luck with your deployment! 🚀
