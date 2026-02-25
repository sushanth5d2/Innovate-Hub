require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const path = require('path');
const compression = require('compression');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { initDatabase } = require('./config/database');
const { initRedis } = require('./config/cache');
const { responseTimeLogger } = require('./middleware/performance');

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

// Trust proxy (required for rate limiting in development containers)
app.set('trust proxy', 1);

// Security middleware
app.use(helmet({
  contentSecurityPolicy: false, // Disable for now to allow inline scripts
  crossOriginEmbedderPolicy: false
}));

// Rate limiting (relaxed in development)
const isProd = (process.env.NODE_ENV === 'production');
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || (15 * 60 * 1000)),
  max: parseInt(process.env.RATE_LIMIT_MAX || (isProd ? 100 : 1000)),
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many requests from this IP, please try again later.',
  handler: (req, res, next, options) => {
    res.status(options.statusCode).json({ error: options.message || 'Too many requests, please try again later.' });
  }
});

const authLimiter = rateLimit({
  windowMs: parseInt(process.env.AUTH_RATE_LIMIT_WINDOW_MS || (15 * 60 * 1000)),
  max: parseInt(process.env.AUTH_RATE_LIMIT_MAX || (isProd ? 5 : 20)),
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many login attempts, please try again later.',
  handler: (req, res, next, options) => {
    res.status(options.statusCode).json({ error: options.message || 'Too many login attempts, please try again later.' });
  }
});

app.use('/api/', limiter);
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);

// Compression middleware
app.use(compression());

// Performance monitoring
app.use(responseTimeLogger);

// Middleware
app.use(cors({
  origin: '*',
  credentials: true
}));
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));
app.use(cookieParser());

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
app.use('/api', require('./routes/community-groups'));

// Link preview endpoint
app.get('/api/link-preview', async (req, res) => {
  const url = req.query.url;
  if (!url) return res.json({ error: 'URL required' });
  
  try {
    const https = require(url.startsWith('https') ? 'https' : 'http');
    const fetchUrl = (targetUrl, redirectCount = 0) => new Promise((resolve, reject) => {
      if (redirectCount > 3) return reject(new Error('Too many redirects'));
      const mod = targetUrl.startsWith('https') ? require('https') : require('http');
      const request = mod.get(targetUrl, { 
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; InnovateBot/1.0)' },
        timeout: 5000
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
    connectedUsers.set(userId, socket.id);
    socket.userId = userId;
    
    // Join user-specific room for receiving messages
    socket.join(`user_${userId}`);
    console.log(`User ${userId} joined room user_${userId}, socket: ${socket.id}`);
    
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
    }
  });

  // WebRTC Call Signaling
  socket.on('call:initiate', (data) => {
    const { to, from, offer, isVideo, caller } = data;
    console.log(`Call initiated from ${from} to ${to}, video: ${isVideo}`);
    console.log(`Emitting to room: user_${to}`);
    io.to(`user_${to}`).emit('call:incoming', {
      from,
      offer,
      isVideo,
      caller
    });
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

  // === Group Call (WebRTC mesh) ===
  // Client joins a group call room to exchange offers/answers/ICE.
  socket.on('group-call:join', (data) => {
    try {
      const { groupId, userId, displayName } = data || {};
      if (!groupId) return;

      const room = `group_call_${groupId}`;
      socket.join(room);
      groupCallPresence.set(socket.id, { groupId: String(groupId), userId, displayName });

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
            displayName: p?.displayName
          });
        }
      }

      socket.emit('group-call:peers', { groupId, peers });
      socket.to(room).emit('group-call:peer-joined', {
        groupId,
        peer: { socketId: socket.id, userId, displayName }
      });
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

app.get('/profile/:id', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'profile.html'));
});

app.get('/notifications', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'notifications.html'));
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

app.get('/group.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'group.html'));
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

const PORT = process.env.PORT || 3000;

async function startServer() {
  try {
    // Initialize database
    await initDatabase();
    
    // Initialize Redis cache (optional)
    await initRedis();
    
    server.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
      console.log(`Visit http://localhost:${PORT}`);
      console.log('Environment:', process.env.NODE_ENV || 'development');
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();

// Handle graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, closing server gracefully');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

module.exports = { app, io };
