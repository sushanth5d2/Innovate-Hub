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
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

// Serve static files
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: process.env.NODE_ENV === 'production' ? '1d' : 0,
  etag: true
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
app.use('/api/groups', require('./routes/groups'));
app.use('/api', require('./routes/community-groups'));

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
}, 60000); // Run every 60 seconds

// Socket.IO connection handling
const connectedUsers = new Map();

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

  // Disconnect
  socket.on('disconnect', () => {
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
