// Load environment from single .env file
// Switch NODE_ENV in .env between 'development' and 'production'
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });

const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const compression = require('compression');
const helmet = require('helmet');
const { initDatabase } = require('./config/database');
const { initRedis } = require('./config/cache');
const logger = require('./config/logger');
const authMiddleware = require('./middleware/auth');
const { responseTimeLogger } = require('./middleware/performance');
const pushService = require('./services/push-service');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: process.env.ALLOWED_ORIGINS || '*',
    methods: ['GET', 'POST'],
    credentials: true
  },
  transports: ['websocket', 'polling'],
  allowEIO3: true
});

// Make io accessible to routes
app.set('io', io);

const isProd = process.env.NODE_ENV === 'production';

// Trust proxy (needed behind nginx/load balancer in production, and in dev containers)
app.set('trust proxy', isProd ? 1 : 1);

// Security middleware - stricter in production
app.use(helmet({
  contentSecurityPolicy: isProd ? {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https://cdn.socket.io", "https://cdnjs.cloudflare.com", "https://cdn.quilljs.com", "https://cdn.jsdelivr.net", "https://unpkg.com"],
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdnjs.cloudflare.com", "https://cdn.quilljs.com", "https://cdn.jsdelivr.net", "https://unpkg.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com", "https://cdnjs.cloudflare.com"],
      imgSrc: ["'self'", "data:", "blob:", "https:"],
      connectSrc: ["'self'", "wss:", "ws:", "https:", process.env.PYTHON_ML_SERVICE_URL || 'http://localhost:5000'].filter(Boolean),
      mediaSrc: ["'self'", "blob:"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"]
    }
  } : false,
  crossOriginEmbedderPolicy: false,
  hsts: isProd ? { maxAge: 31536000, includeSubDomains: true } : false
}));

// Rate limiting DISABLED — no per-IP limits in production
// For 1Cr+ users, DDoS protection is handled at infrastructure level (CDN/WAF/Load Balancer)
// NOT at the application layer. Application-level rate limiting blocks legitimate users at scale.
// If needed, enable via nginx, Cloudflare, or AWS WAF instead.

// Compression middleware
app.use(compression());

// Performance monitoring
app.use(responseTimeLogger);

// CORS - environment-aware
const corsOrigins = process.env.ALLOWED_ORIGINS || '*';
app.use(cors({
  origin: isProd && corsOrigins !== '*'
    ? corsOrigins.split(',').map(o => o.trim())
    : true,   // true = reflect request origin (allows credentials; safer than '*' string)
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Body parsing - smaller limits in production to prevent abuse
const bodyLimit = isProd ? '10mb' : '100mb';
app.use(express.json({ limit: bodyLimit }));
app.use(express.urlencoded({ extended: true, limit: bodyLimit }));
app.use(cookieParser());

// Handle JSON parse errors gracefully (returns 400 instead of 500)
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Invalid JSON in request body' });
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Request payload too large' });
  }
  next(err);
});

// Serve static files
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: process.env.NODE_ENV === 'production' ? '1d' : 0,
  etag: false,
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html') || filePath.endsWith('.js') || filePath.endsWith('.css')) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
    }
  }
}));
app.use('/uploads', express.static(path.join(__dirname, 'uploads'), {
  maxAge: process.env.NODE_ENV === 'production' ? '7d' : 0
}));

// Initialize database (removed - will be called in startServer)
// initDatabase();

// Health check endpoint — used by Docker, load balancers, monitoring
app.get('/api/health', async (req, res) => {
  const checks = { status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() };
  try {
    const { getDb } = require('./config/database');
    const db = getDb();
    await new Promise((resolve, reject) => {
      const q = process.env.DB_TYPE === 'postgresql' ? 'SELECT 1' : 'SELECT 1';
      db.get(q, [], (err) => err ? reject(err) : resolve());
    });
    checks.database = 'connected';
  } catch (e) {
    checks.database = 'error';
    checks.status = 'degraded';
  }
  const statusCode = checks.status === 'ok' ? 200 : 503;
  res.status(statusCode).json(checks);
});

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/posts', require('./routes/posts'));
app.use('/api/messages', require('./routes/messages'));
app.use('/api/communities', require('./routes/communities'));
app.use('/api/events', require('./routes/events'));
app.use('/api/users', require('./routes/users'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/search', require('./routes/search'));
app.use('/api/ml', require('./routes/ml'));
app.use('/api/social-service', require('./routes/social-service'));
app.use('/api/todos', require('./routes/todos'));
app.use('/api/reminders', require('./routes/reminders'));
app.use('/api/groups', require('./routes/groups'));
app.use('/api/ai-chat', require('./routes/ai-chat'));
app.use('/api/portfolio', require('./routes/portfolio'));
app.use('/api/shared', require('./routes/shared-tasks-notes'));
app.use('/api/calls', require('./routes/calls'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api', require('./routes/community-groups'));

// Link preview endpoint (SSRF-protected)
app.get('/api/link-preview', authMiddleware, async (req, res) => {
  const url = req.query.url;
  if (!url) return res.json({ error: 'URL required' });
  
  // Validate URL scheme
  let parsed;
  try { parsed = new URL(url); } catch { return res.json({ error: 'Invalid URL' }); }
  if (!['http:', 'https:'].includes(parsed.protocol)) return res.json({ error: 'Only HTTP(S) allowed' });

  // SSRF protection: resolve hostname and block private/internal IPs
  const dns = require('dns');
  const isPrivateIP = (ip) => {
    const parts = ip.split('.').map(Number);
    if (parts.length === 4) {
      if (parts[0] === 127) return true;                         // 127.x.x.x
      if (parts[0] === 10) return true;                          // 10.x.x.x
      if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true; // 172.16-31.x.x
      if (parts[0] === 192 && parts[1] === 168) return true;    // 192.168.x.x
      if (parts[0] === 169 && parts[1] === 254) return true;    // 169.254.x.x (link-local)
      if (parts[0] === 0) return true;                           // 0.x.x.x
    }
    // IPv6 loopback/private
    if (ip === '::1' || ip === '::' || ip.startsWith('fc') || ip.startsWith('fd') || ip.startsWith('fe80')) return true;
    return false;
  };

  try {
    const addresses = await new Promise((resolve, reject) => {
      dns.resolve4(parsed.hostname, (err, addrs) => {
        if (err) {
          // Try as literal IP
          const net = require('net');
          if (net.isIP(parsed.hostname)) return resolve([parsed.hostname]);
          return reject(err);
        }
        resolve(addrs);
      });
    });
    if (addresses.some(isPrivateIP)) return res.json({ error: 'URL not allowed' });
  } catch {
    return res.json({ error: 'Could not resolve hostname' });
  }

  try {
    const fetchUrl = (targetUrl, redirectCount = 0) => new Promise((resolve, reject) => {
      if (redirectCount > 3) return reject(new Error('Too many redirects'));
      // Re-validate redirect targets against SSRF
      let rParsed;
      try { rParsed = new URL(targetUrl); } catch { return reject(new Error('Invalid redirect URL')); }
      if (!['http:', 'https:'].includes(rParsed.protocol)) return reject(new Error('Invalid redirect protocol'));

      const mod = targetUrl.startsWith('https') ? require('https') : require('http');
      const request = mod.get(targetUrl, { 
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; InnovateBot/1.0)' },
        timeout: 5000,
        // Block connection to private IPs at socket level
        lookup: (hostname, opts, cb) => {
          dns.resolve4(hostname, (err, addrs) => {
            if (err) return cb(err);
            const safe = addrs.filter(a => !isPrivateIP(a));
            if (safe.length === 0) return cb(new Error('Blocked private IP'));
            cb(null, safe[0], 4);
          });
        }
      }, (response) => {
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          return resolve(fetchUrl(response.headers.location, redirectCount + 1));
        }
        let data = '';
        response.setEncoding('utf8');
        response.on('data', chunk => {
          data += chunk;
          if (data.length > 50000) response.destroy(); // limit
        });
        response.on('end', () => resolve(data));
      });
      request.on('error', reject);
      request.on('timeout', () => { request.destroy(); reject(new Error('Timeout')); });
    });

    const html = await fetchUrl(url);
    
    const getMetaContent = (html, property) => {
      const patterns = [
        new RegExp(`<meta[^>]*property=["']${property}["'][^>]*content=["']([^"']*)["']`, 'i'),
        new RegExp(`<meta[^>]*content=["']([^"']*)["'][^>]*property=["']${property}["']`, 'i'),
        new RegExp(`<meta[^>]*name=["']${property}["'][^>]*content=["']([^"']*)["']`, 'i'),
        new RegExp(`<meta[^>]*content=["']([^"']*)["'][^>]*name=["']${property}["']`, 'i'),
      ];
      for (const p of patterns) {
        const m = html.match(p);
        if (m) return m[1];
      }
      return null;
    };

    const title = getMetaContent(html, 'og:title') || getMetaContent(html, 'twitter:title') || (html.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1] || '';
    const description = getMetaContent(html, 'og:description') || getMetaContent(html, 'twitter:description') || getMetaContent(html, 'description') || '';
    let image = getMetaContent(html, 'og:image') || getMetaContent(html, 'twitter:image') || '';
    
    // Make relative image URLs absolute
    if (image && !image.startsWith('http')) {
      try {
        const urlObj = new URL(url);
        image = image.startsWith('/') ? `${urlObj.protocol}//${urlObj.host}${image}` : `${urlObj.protocol}//${urlObj.host}/${image}`;
      } catch(_) {}
    }

    res.json({ title: title.trim(), description: description.trim(), image });
  } catch (e) {
    res.json({ error: 'Failed to fetch preview' });
  }
});

// Serve HTML pages
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/register', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'register.html'));
});

app.get('/home', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'home.html'));
});

// Clean up expired timer messages every minute
setInterval(() => {
  const { getDb } = require('./config/database');
  const db = getDb();
  
  // First, get expired messages to notify users
  db.all(`
    SELECT id, sender_id, receiver_id 
    FROM messages 
    WHERE expires_at IS NOT NULL 
    AND datetime(expires_at) <= datetime('now')
  `, (err, expiredMessages) => {
    if (err) {
      console.error('Error fetching expired messages:', err);
      return;
    }
    
    // Notify users via socket
    expiredMessages.forEach(msg => {
      io.to(`user_${msg.sender_id}`).emit('message:expired', msg.id);
      io.to(`user_${msg.receiver_id}`).emit('message:expired', msg.id);
    });
    
    // Delete expired messages
    db.run(`
      DELETE FROM messages 
      WHERE expires_at IS NOT NULL 
      AND datetime(expires_at) <= datetime('now')
    `, (err) => {
      if (err) console.error('Error cleaning expired messages:', err);
      else if (expiredMessages.length > 0) {
        console.log(`Cleaned ${expiredMessages.length} expired messages`);
      }
    });
  });
  
  // Clean up expired pinned messages
  db.all(`
    SELECT id, group_id 
    FROM community_group_posts 
    WHERE pin_expires_at IS NOT NULL 
    AND datetime(pin_expires_at) <= datetime('now')
    AND pinned_at IS NOT NULL
  `, (err, expiredPins) => {
    if (err) {
      console.error('Error fetching expired pins:', err);
      return;
    }
    
    // Notify via socket and unpin
    expiredPins.forEach(msg => {
      io.to(`community_group_${msg.group_id}`).emit('message:unpinned', { messageId: msg.id });
    });
    
    // Unpin expired messages
    db.run(`
      UPDATE community_group_posts 
      SET pinned_at = NULL, pinned_by = NULL, pin_expires_at = NULL 
      WHERE pin_expires_at IS NOT NULL 
      AND datetime(pin_expires_at) <= datetime('now')
    `, (err) => {
      if (err) console.error('Error unpinning expired messages:', err);
      else if (expiredPins.length > 0) {
        console.log(`Unpinned ${expiredPins.length} expired pinned messages`);
      }
    });
  });
}, 60000); // Run every 60 seconds

// Socket.IO connection handling
const connectedUsers = new Map();

// Group call participation (WebRTC signaling)
// Map socket.id -> { groupId, userId, displayName }
const groupCallPresence = new Map();

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // User joins with their userId
  socket.on('user:join', (userId) => {
    if (!userId) return;
    connectedUsers.set(userId, socket.id);
    socket.userId = userId;
    
    // Join user-specific rooms for receiving messages/notifications
    // Some routes use user_${id} (underscore) and some use user-${id} (hyphen)
    socket.join(`user_${userId}`);
    socket.join(`user-${userId}`);
    console.log(`User ${userId} joined rooms user_${userId} & user-${userId}, socket: ${socket.id}`);
    
    // Broadcast online status
    io.emit('user:online', userId);
  });

  // Join community room
  socket.on('community:join', (communityId) => {
    socket.join(`community_${communityId}`);
  });

  // Join a community-group room for realtime posts
  socket.on('community-group:join', (groupId) => {
    if (!groupId) return;
    socket.join(`community_group_${groupId}`);
  });

  socket.on('community-group:leave', (groupId) => {
    if (!groupId) return;
    socket.leave(`community_group_${groupId}`);
  });

  // Leave community room
  socket.on('community:leave', (communityId) => {
    socket.leave(`community_${communityId}`);
  });

  // Send message
  socket.on('message:send', (data) => {
    const { receiverId, message } = data;
    const receiverSocketId = connectedUsers.get(receiverId);
    
    if (receiverSocketId) {
      io.to(receiverSocketId).emit('message:receive', message);
    } else {
      // User is offline — send push notification
      pushService.sendMessagePush(
        receiverId,
        message.sender_username || message.username || 'Someone',
        message.content || 'Sent you a message',
        message.sender_id || socket.userId
      );
    }
  });

  // Community chat message
  socket.on('community:message', (data) => {
    const { communityId, message } = data;
    io.to(`community_${communityId}`).emit('community:message:receive', message);
  });

  // Typing indicator
  socket.on('typing:start', (data) => {
    const { receiverId } = data;
    const receiverSocketId = connectedUsers.get(receiverId);
    
    if (receiverSocketId) {
      io.to(receiverSocketId).emit('typing:start', { userId: socket.userId });
    }
  });

  // Group chat message broadcast (basic)
  socket.on('group:join', (groupId) => {
    socket.join(`group_${groupId}`);
  });

  socket.on('group:leave', (groupId) => {
    socket.leave(`group_${groupId}`);
  });

  socket.on('group:message', (data) => {
    const { groupId, message } = data;
    io.to(`group_${groupId}`).emit('group:message:receive', message);
  });

  socket.on('typing:stop', (data) => {
    const { receiverId } = data;
    const receiverSocketId = connectedUsers.get(receiverId);
    
    if (receiverSocketId) {
      io.to(receiverSocketId).emit('typing:stop', { userId: socket.userId });
    }
  });

  // Send notification
  socket.on('notification:send', (data) => {
    const { userId, notification } = data;
    const userSocketId = connectedUsers.get(userId);
    
    if (userSocketId) {
      io.to(userSocketId).emit('notification:receive', notification);
    } else {
      // User is offline — send push notification
      pushService.sendNotificationPush(
        userId,
        notification.title || 'Innovate Hub',
        notification.content || notification.body || 'You have a new notification',
        { type: notification.type || 'general' }
      );
    }
  });

  // WebRTC Call Signaling
  socket.on('call:initiate', (data) => {
    const { to, from, offer, isVideo, caller, isGroupAdd, groupId } = data;
    console.log(`Call initiated from ${from} to ${to}, video: ${isVideo}, groupAdd: ${!!isGroupAdd}`);
    console.log(`Emitting to room: user_${to}`);
    io.to(`user_${to}`).emit('call:incoming', {
      from,
      offer,
      isVideo,
      caller,
      isGroupAdd: !!isGroupAdd,
      groupId: groupId || null
    });

    // Also send high-priority push notification for incoming call (works on lock screen)
    pushService.sendCallPush(
      to,
      caller?.username || caller?.displayName || 'Someone',
      from,
      isVideo,
      !!isGroupAdd,
      groupId || null
    );
  });

  socket.on('call:answer', (data) => {
    const { to, answer } = data;
    console.log(`Call answered, sending to user_${to}`);
    io.to(`user_${to}`).emit('call:answered', { answer });
  });

  socket.on('call:ice-candidate', (data) => {
    const { to, candidate } = data;
    io.to(`user_${to}`).emit('call:ice-candidate', { candidate });
  });

  socket.on('call:reject', (data) => {
    const { to } = data;
    console.log(`Call rejected, notifying user_${to}`);
    io.to(`user_${to}`).emit('call:rejected');
  });

  socket.on('call:end', (data) => {
    const { to } = data;
    console.log(`Call ended, notifying user_${to}`);
    io.to(`user_${to}`).emit('call:ended');
  });

  // Renegotiation (mid-call track changes: screen share, add video to voice call)
  socket.on('call:renegotiate', (data) => {
    const { to, offer } = data;
    io.to(`user_${to}`).emit('call:renegotiate', { offer });
  });

  socket.on('call:renegotiate-answer', (data) => {
    const { to, answer } = data;
    io.to(`user_${to}`).emit('call:renegotiate-answer', { answer });
  });

  // Multi-device: call answered on one device → dismiss on others
  socket.on('call:answered-on-device', (data) => {
    const { userId } = data;
    // Emit to all sockets of this user EXCEPT the current one
    const room = `user_${userId}`;
    socket.to(room).emit('call:answered-elsewhere');
  });

  // Add member to active call signaling
  socket.on('call:add-member-offer', (data) => {
    const { to, offer, userId, username, profile_picture } = data;
    io.to(`user_${to}`).emit('call:add-member-offer', {
      fromSocketId: socket.id,
      offer,
      userId,
      username,
      profile_picture
    });
  });

  socket.on('call:add-member-answer', (data) => {
    const { to, answer } = data;
    io.to(to).emit('call:add-member-answer', { fromSocketId: socket.id, answer });
  });

  socket.on('call:add-member-ice', (data) => {
    const { to, candidate } = data;
    io.to(to).emit('call:add-member-ice', { fromSocketId: socket.id, candidate });
  });

  // Screen share signaling — relay to peers
  socket.on('call:screen-share', (data) => {
    const { to, sharing } = data || {};
    if (!to) return;
    io.to(`user_${to}`).emit('call:screen-share', { from: socket.id, sharing: !!sharing });
  });

  socket.on('group-call:screen-share', (data) => {
    const { groupId, sharing } = data || {};
    if (!groupId) return;
    socket.to(`group_call_${groupId}`).emit('group-call:screen-share', { from: socket.id, sharing: !!sharing, groupId });
  });

  // === Group Call (WebRTC mesh) ===
  // Client joins a group call room to exchange offers/answers/ICE.
  socket.on('group-call:join', (data) => {
    try {
      const { groupId, userId, displayName, isVideo, profilePicture, groupPicture } = data || {};
      if (!groupId) return;

      const room = `group_call_${groupId}`;
      socket.join(room);
      groupCallPresence.set(socket.id, { groupId: String(groupId), userId, displayName, isVideo, profilePicture });

      // List current peers in the room (excluding this socket)
      const peers = [];
      const roomSockets = io.sockets.adapter.rooms.get(room);
      if (roomSockets) {
        for (const sid of roomSockets) {
          if (sid === socket.id) continue;
          const p = groupCallPresence.get(sid);
          peers.push({
            socketId: sid,
            userId: p?.userId,
            displayName: p?.displayName,
            profilePicture: p?.profilePicture || null
          });
        }
      }

      socket.emit('group-call:peers', { groupId, peers });
      socket.to(room).emit('group-call:peer-joined', {
        groupId,
        peer: { socketId: socket.id, userId, displayName, profilePicture: profilePicture || null }
      });

      // Broadcast to all group members via the chat room
      const participantCount = roomSockets ? roomSockets.size : 1;
      
      // If this is the first person joining (starting the call), ring all group members
      if (participantCount <= 1) {
        // Query group_members table to get all member user IDs and ring each one individually
        const { getDb } = require('./config/database');
        const db = getDb();
        // Also fetch group name for the ring notification
        db.get('SELECT name, profile_picture FROM community_groups WHERE id = ?', [groupId], (nameErr, groupRow) => {
          db.all('SELECT user_id FROM group_members WHERE group_id = ?', [groupId], (err, members) => {
            if (err) {
              console.error('Failed to query group members for ring:', err);
              return;
            }
            const ringData = {
              groupId,
              callerId: userId,
              callerName: displayName,
              callerPicture: profilePicture || null,
              groupPicture: groupPicture || (groupRow ? groupRow.profile_picture : null),
              groupName: groupRow ? groupRow.name : null,
              isVideo: !!isVideo,
              participantCount
            };
            (members || []).forEach(m => {
              if (String(m.user_id) !== String(userId)) {
                io.to(`user_${m.user_id}`).emit('group-call:ring', ringData);
                // Send push notification for group call (works on lock screen)
                pushService.sendCallPush(
                  m.user_id,
                  displayName || 'Someone',
                  userId,
                  !!isVideo,
                  true,
                  groupId
                );
              }
            });
          });
        });
      }
      
      // Also broadcast the started event for banners
      io.to(`group_${groupId}`).emit('group-call:started', { groupId, participantCount });
    } catch (e) {
      console.error('group-call:join error', e);
    }
  });

  socket.on('group-call:signal', (data) => {
    try {
      const { groupId, to, payload } = data || {};
      if (!groupId || !to || !payload) return;
      io.to(to).emit('group-call:signal', { groupId, from: socket.id, payload });
    } catch (e) {
      console.error('group-call:signal error', e);
    }
  });

  socket.on('group-call:leave', (data) => {
    try {
      const { groupId } = data || {};
      if (!groupId) return;
      const room = `group_call_${groupId}`;
      socket.leave(room);
      groupCallPresence.delete(socket.id);
      socket.to(room).emit('group-call:peer-left', { groupId, socketId: socket.id });

      // If room is now empty, broadcast that the call ended
      const roomSockets = io.sockets.adapter.rooms.get(room);
      if (!roomSockets || roomSockets.size === 0) {
        io.to(`group_${groupId}`).emit('group-call:ended', { groupId });
      } else {
        // Update participant count
        io.to(`group_${groupId}`).emit('group-call:started', { groupId, participantCount: roomSockets.size });
      }
    } catch (e) {
      console.error('group-call:leave error', e);
    }
  });

  // Disconnect
  socket.on('disconnect', () => {
    // If user was in a group call, notify room
    const presence = groupCallPresence.get(socket.id);
    if (presence?.groupId) {
      const room = `group_call_${presence.groupId}`;
      // Notify peers that this user stopped screen sharing (if they were)
      socket.to(room).emit('group-call:screen-share', { from: socket.id, sharing: false, groupId: presence.groupId });
      socket.to(room).emit('group-call:peer-left', { groupId: presence.groupId, socketId: socket.id });
      groupCallPresence.delete(socket.id);
    }

    if (socket.userId) {
      connectedUsers.delete(socket.userId);
      io.emit('user:offline', socket.userId);
    }
    console.log('User disconnected:', socket.id);
  });
});

// Serve HTML pages
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/register', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'register.html'));
});

app.get('/home', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'home.html'));
});

app.get('/messages', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'messages.html'));
});

app.get('/communities', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'communities.html'));
});

app.get('/community/:id', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'community.html'));
});

app.get('/events', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'events.html'));
});

app.get('/profile', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'profile.html'));
});

app.get('/profile/:id', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'profile.html'));
});

app.get('/notifications', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'notifications.html'));
});

app.get('/post/:id', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'home.html'));
});

app.get('/search', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'search.html'));
});

app.get('/settings', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'settings.html'));
});

app.get('/follow-requests', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'follow-requests.html'));
});

app.get('/social-service', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'social-service.html'));
});

app.get('/todos', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'todos.html'));
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/admin-login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin-login.html'));
});

app.get('/group.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'group.html'));
});

// Global error handling middleware — catches all unhandled route errors
app.use((err, req, res, next) => {
  const status = err.status || err.statusCode || 500;
  const message = process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message;
  logger.error({ err, method: req.method, url: req.originalUrl, status }, 'Request error');
  if (!res.headersSent) {
    res.status(status).json({ error: message });
  }
});

const PORT = process.env.PORT || 3000;

async function startServer() {
  try {
    // Initialize database
    await initDatabase();
    
    // Initialize Redis cache (optional)
    await initRedis();
    
    server.listen(PORT, () => {
      logger.info({ port: PORT, env: process.env.NODE_ENV || 'development' }, `Server running on port ${PORT}`);
    });
  } catch (error) {
    logger.fatal({ err: error }, 'Failed to start server');
    process.exit(1);
  }
}

startServer();

// Handle graceful shutdown
function gracefulShutdown(signal) {
  logger.info({ signal }, 'Graceful shutdown initiated');
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
  // Force close after 10s
  setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Catch unhandled errors to prevent crashes
process.on('unhandledRejection', (reason, promise) => {
  logger.error({ err: reason }, 'Unhandled Promise Rejection');
});

process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'Uncaught Exception');
  // In production with PM2, exit so process manager restarts cleanly.
  // In development/test, log but don't exit to allow debugging.
  if (isProd && !process.env.RATE_LIMIT_SKIP_LOCAL) {
    setTimeout(() => process.exit(1), 1000);
  }
});

module.exports = { app, io };
