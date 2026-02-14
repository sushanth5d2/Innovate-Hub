const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const upload = require('../middleware/upload');
const { getDb } = require('../config/database');

// Get conversations list
router.get('/conversations', authMiddleware, (req, res) => {
  const db = getDb();
  const userId = req.user.userId;

  // First, get all unique contacts and their last message ID
  const query = `
    WITH contact_messages AS (
      SELECT 
        CASE 
          WHEN sender_id = ? THEN receiver_id
          ELSE sender_id
        END as contact_id,
        MAX(id) as last_message_id
      FROM messages
      WHERE (sender_id = ? OR receiver_id = ?)
        AND (is_deleted_by_sender = 0 OR sender_id != ?)
        AND (is_deleted_by_receiver = 0 OR receiver_id != ?)
      GROUP BY contact_id
    )
    SELECT 
      cm.contact_id,
      u.username,
      u.profile_picture,
      u.is_online,
      u.last_seen,
      m.content as last_message,
      m.type as last_message_type,
      m.original_filename as last_message_filename,
      m.created_at as last_message_time,
      (SELECT COUNT(*) FROM messages 
       WHERE sender_id = cm.contact_id 
       AND receiver_id = ? 
       AND is_read = 0) as unread_count
    FROM contact_messages cm
    JOIN users u ON u.id = cm.contact_id
    LEFT JOIN messages m ON m.id = cm.last_message_id
    ORDER BY m.created_at DESC
  `;

  db.all(query, [userId, userId, userId, userId, userId, userId], (err, conversations) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: 'Error fetching conversations' });
    }
    res.json({ success: true, conversations });
  });
});

// Get messages with a specific user
router.get('/:contactId', authMiddleware, (req, res) => {
  const db = getDb();
  const userId = req.user.userId;
  const { contactId } = req.params;

  const query = `
    SELECT m.*, 
           sender.username as sender_username,
           sender.profile_picture as sender_picture,
           (SELECT COUNT(*) > 0 FROM starred_messages WHERE user_id = ? AND message_id = m.id) as is_starred
    FROM messages m
    JOIN users sender ON m.sender_id = sender.id
    WHERE ((m.sender_id = ? AND m.receiver_id = ? AND m.is_deleted_by_sender = 0)
       OR (m.sender_id = ? AND m.receiver_id = ? AND m.is_deleted_by_receiver = 0))
    ORDER BY m.created_at ASC
  `;

  db.all(query, [userId, userId, contactId, contactId, userId], (err, messages) => {
    if (err) {
      return res.status(500).json({ error: 'Error fetching messages' });
    }

    // Mark messages as read
    db.run(
      'UPDATE messages SET is_read = 1 WHERE sender_id = ? AND receiver_id = ? AND is_read = 0',
      [contactId, userId]
    );

    messages = messages.map(msg => ({
      ...msg,
      attachments: msg.attachments ? JSON.parse(msg.attachments) : []
    }));

    res.json({ success: true, messages });
  });
});

// Send message
router.post('/send', authMiddleware, (req, res, next) => {
  // Use multer middleware
  upload.fields([
    { name: 'file', maxCount: 1 },
    { name: 'audio', maxCount: 1 }
  ])(req, res, (err) => {
    if (err) {
      console.error('Multer error:', err.message);
      return res.status(400).json({ error: err.message });
    }
    
    const db = getDb();
    const senderId = req.user.userId;
    const { receiver_id, content, type, timer } = req.body;
    
    if (!receiver_id) {
      return res.status(400).json({ error: 'receiver_id is required' });
    }
    
    let messageContent = content;
    let messageType = type || 'text';
    
    // Handle file upload
    let originalFilename = null;
    if (req.files?.file) {
      const file = req.files.file[0];
      originalFilename = file.originalname;
      console.log('File uploaded:', originalFilename, 'MIME:', file.mimetype);
      messageContent = file.mimetype.startsWith('image/') 
        ? `/uploads/images/${file.filename}`
        : `/uploads/files/${file.filename}`;
      messageType = file.mimetype.startsWith('image/') ? 'image' : 
                    file.mimetype.startsWith('video/') ? 'video' : 'file';
    }
    
    // Handle voice message
    if (req.files?.audio) {
      const audio = req.files.audio[0];
      originalFilename = audio.originalname;
      messageContent = `/uploads/files/${audio.filename}`;
      messageType = 'voice';
    }

    // Calculate expiration time if timer is set
    let expiresAt = null;
    if (timer) {
      const now = new Date();
      now.setSeconds(now.getSeconds() + parseInt(timer));
      expiresAt = now.toISOString();
    }

    const query = `
      INSERT INTO messages (sender_id, receiver_id, content, type, timer, expires_at, original_filename, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `;

    db.run(query, [senderId, receiver_id, messageContent, messageType, timer || null, expiresAt, originalFilename], function(err) {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).json({ error: 'Error sending message' });
      }

      const messageId = this.lastID;

    // Get the created message
    db.get(
      'SELECT * FROM users WHERE id = ?',
      [senderId],
      (err, sender) => {
        if (err) return res.status(500).json({ error: 'Error' });

        const messageData = {
          id: messageId,
          sender_id: senderId,
          receiver_id,
          content: messageContent,
          type: messageType,
          timer: timer || null,
          expires_at: expiresAt,
          original_filename: originalFilename,
          sender_username: sender.username,
          sender_picture: sender.profile_picture,
          created_at: new Date().toISOString()
        };

        // Emit socket event
        const io = req.app.get('io');
        io.to(`user_${receiver_id}`).emit('new_message', messageData);
        io.to(`user_${senderId}`).emit('new_message', { ...messageData, is_own: true });

        // Create notification
        db.run(
          `INSERT INTO notifications (user_id, type, content, related_id, created_by, created_at)
           VALUES (?, 'message', ?, ?, ?, datetime('now'))`,
          [receiver_id, `New message from ${sender.username}`, messageId, senderId]
        );

        io.to(`user_${receiver_id}`).emit('new_notification', {
          type: 'message',
          content: `New message from ${sender.username}`,
          created_at: new Date().toISOString()
        });

        res.json({ success: true, message: messageData });
      }
    );
  });
  });
});

// Original send endpoint for backward compatibility
router.post('/', authMiddleware, upload.array('attachments', 5), (req, res) => {
  const db = getDb();
  const senderId = req.user.userId;
  const { receiver_id, content, timer, reply_to_id } = req.body;

  let attachments = [];
  if (req.files) {
    attachments = req.files.map(file => ({
      name: file.originalname,
      path: file.mimetype.startsWith('image/') ? `/uploads/images/${file.filename}` : `/uploads/files/${file.filename}`,
      type: file.mimetype,
      size: file.size
    }));
  }

  // Calculate expiration time if timer is set
  let expiresAt = null;
  if (timer) {
    const now = new Date();
    now.setSeconds(now.getSeconds() + parseInt(timer));
    expiresAt = now.toISOString();
  }

  const query = `
    INSERT INTO messages (sender_id, receiver_id, content, attachments, timer, expires_at, reply_to_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `;

  db.run(query, [senderId, receiver_id, content, JSON.stringify(attachments), timer || null, expiresAt, reply_to_id || null], function(err) {
    if (err) {
      return res.status(500).json({ error: 'Error sending message' });
    }

    // Create notification
    db.run(
      'INSERT INTO notifications (user_id, type, content, related_id) VALUES (?, ?, ?, ?)',
      [receiver_id, 'message', 'sent you a message', senderId]
    );

    res.json({
      success: true,
      message: {
        id: this.lastID,
        sender_id: senderId,
        receiver_id,
        content,
        attachments,
        timer: timer || null,
        expires_at: expiresAt,
        created_at: new Date().toISOString()
      }
    });
  });
});

// Edit message
router.put('/:messageId', authMiddleware, upload.single('file'), (req, res) => {
  const db = getDb();
  const userId = req.user.userId;
  const { messageId } = req.params;
  const { content, attachmentAction, fileType } = req.body;

  // First, get the current message to check ownership and existing file
  db.get(
    'SELECT * FROM messages WHERE id = ? AND sender_id = ?',
    [messageId, userId],
    (err, message) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }
      if (!message) {
        return res.status(404).json({ error: 'Message not found or unauthorized' });
      }

      // Determine the update based on attachment action
      let newContent = content || message.content;
      let newType = message.type;
      let newFilePath = message.content;
      let newOriginalFilename = message.original_filename;

      // Handle attachment removal
      if (attachmentAction === 'remove') {
        newType = 'text';
        newFilePath = content || '';
        newOriginalFilename = null;
      }
      // Handle attachment replacement with new file
      else if (attachmentAction === 'replace' && req.file) {
        const file = req.file;
        newType = fileType || 'file';
        
        // Determine file path based on type
        if (file.mimetype.startsWith('image/')) {
          newFilePath = `/uploads/images/${file.filename}`;
          newType = 'image';
        } else if (file.mimetype.startsWith('video/')) {
          newFilePath = `/uploads/videos/${file.filename}`;
          newType = 'video';
        } else {
          newFilePath = `/uploads/files/${file.filename}`;
          newType = 'file';
        }
        
        newOriginalFilename = file.originalname;
        // Keep the text content (caption) if provided
        newContent = content || '';
      }
      // Keep existing attachment (text edit only)
      else {
        if (message.type !== 'text') {
          // Don't overwrite the file path with text content
          newFilePath = message.content;
          newOriginalFilename = message.original_filename;
        } else {
          newFilePath = content;
        }
      }

      // Update the message
      const updateQuery = `
        UPDATE messages 
        SET content = ?, 
            type = ?, 
            original_filename = ?,
            updated_at = CURRENT_TIMESTAMP 
        WHERE id = ? AND sender_id = ?
      `;

      db.run(
        updateQuery,
        [newFilePath, newType, newOriginalFilename, messageId, userId],
        function(err) {
          if (err) {
            console.error('Update error:', err);
            return res.status(500).json({ error: 'Error editing message' });
          }
          if (this.changes === 0) {
            return res.status(404).json({ error: 'Message not found or unauthorized' });
          }

          // Emit socket event for real-time update
          const io = req.app.get('io');
          if (message.receiver_id) {
            io.to(`user_${message.receiver_id}`).emit('message_edited', {
              id: messageId,
              content: newFilePath,
              type: newType,
              original_filename: newOriginalFilename,
              updated_at: new Date().toISOString()
            });
          }

          res.json({ 
            success: true,
            message: {
              id: messageId,
              content: newFilePath,
              type: newType,
              original_filename: newOriginalFilename
            }
          });
        }
      );
    }
  );
});

// Unsend message (delete for both)
router.delete('/:messageId/unsend', authMiddleware, (req, res) => {
  const db = getDb();
  const userId = req.user.userId;
  const { messageId } = req.params;

  db.run(
    'DELETE FROM messages WHERE id = ? AND sender_id = ?',
    [messageId, userId],
    function(err) {
      if (err) {
        return res.status(500).json({ error: 'Error unsending message' });
      }
      if (this.changes === 0) {
        return res.status(404).json({ error: 'Message not found or unauthorized' });
      }
      res.json({ success: true });
    }
  );
});

// Delete message (for self only)
router.delete('/:messageId', authMiddleware, (req, res) => {
  const db = getDb();
  const userId = req.user.userId;
  const { messageId } = req.params;

  // Check if user is sender or receiver
  db.get('SELECT * FROM messages WHERE id = ?', [messageId], (err, message) => {
    if (err || !message) {
      return res.status(404).json({ error: 'Message not found' });
    }

    if (message.sender_id === userId) {
      db.run('UPDATE messages SET is_deleted_by_sender = 1 WHERE id = ?', [messageId]);
    } else if (message.receiver_id === userId) {
      db.run('UPDATE messages SET is_deleted_by_receiver = 1 WHERE id = ?', [messageId]);
    } else {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    res.json({ success: true });
  });
});

// Pin/Unpin a message
router.post('/:messageId/pin', authMiddleware, (req, res) => {
  const db = getDb();
  const userId = req.user.userId;
  const { messageId } = req.params;
  const { pinDuration } = req.body; // days or null for permanent

  console.log('Pin endpoint called:', { messageId, userId, body: req.body, pinDuration });

  // Check if message exists and user has access
  const checkQuery = `
    SELECT * FROM messages 
    WHERE id = ? AND (sender_id = ? OR receiver_id = ?)
  `;

  db.get(checkQuery, [messageId, userId, userId], (err, message) => {
    if (err) {
      console.error('Error checking message:', err);
      return res.status(500).json({ error: 'Error checking message' });
    }
    if (!message) {
      console.log('Message not found');
      return res.status(404).json({ error: 'Message not found' });
    }

    console.log('Message found:', { id: message.id, is_pinned: message.is_pinned });

    // Check if pinDuration exists in body (even if it's null)
    const hasPinDuration = Object.prototype.hasOwnProperty.call(req.body, 'pinDuration');
    
    if (hasPinDuration) {
      // Pinning with duration
      let pinExpiry = null;
      if (pinDuration !== null && pinDuration !== undefined) {
        // Calculate expiry time
        const expiryDate = new Date();
        expiryDate.setDate(expiryDate.getDate() + parseInt(pinDuration));
        pinExpiry = expiryDate.toISOString();
      }
      
      const updateQuery = `
        UPDATE messages 
        SET is_pinned = 1,
            pinned_at = datetime('now'),
            pinned_by = ?,
            pin_expires_at = ?
        WHERE id = ?
      `;
      const params = [userId, pinExpiry, messageId];
      
      console.log('Pinning message:', { params, pinExpiry });
      
      db.run(updateQuery, params, function(err) {
        if (err) {
          console.error('Error pinning message:', err);
          return res.status(500).json({ error: 'Error pinning message: ' + err.message });
        }
        console.log('Message pinned successfully');
        res.json({ success: true, pinned: true });
      });
    } else {
      // Unpinning (no pinDuration in body means unpin)
      const updateQuery = `
        UPDATE messages 
        SET is_pinned = 0,
            pinned_at = NULL,
            pinned_by = NULL,
            pin_expires_at = NULL
        WHERE id = ?
      `;
      
      console.log('Unpinning message:', messageId);
      
      db.run(updateQuery, [messageId], function(err) {
        if (err) {
          console.error('Error unpinning message:', err);
          return res.status(500).json({ error: 'Error unpinning message: ' + err.message });
        }
        console.log('Message unpinned successfully');
        res.json({ success: true, pinned: false });
      });
    }
  });
});

// Star/Favorite a message
router.post('/:messageId/star', authMiddleware, (req, res) => {
  const db = getDb();
  const userId = req.user.userId;
  const { messageId } = req.params;

  // Check if already starred
  const checkQuery = 'SELECT * FROM starred_messages WHERE user_id = ? AND message_id = ?';
  
  db.get(checkQuery, [userId, messageId], (err, row) => {
    if (err) {
      return res.status(500).json({ error: 'Error checking star status' });
    }

    if (row) {
      // Unstar
      db.run('DELETE FROM starred_messages WHERE user_id = ? AND message_id = ?', [userId, messageId], function(err) {
        if (err) {
          return res.status(500).json({ error: 'Error removing star' });
        }
        res.json({ success: true, starred: false });
      });
    } else {
      // Star
      db.run('INSERT INTO starred_messages (user_id, message_id, starred_at) VALUES (?, ?, datetime("now"))', 
        [userId, messageId], 
        function(err) {
          if (err) {
            return res.status(500).json({ error: 'Error adding star' });
          }
          res.json({ success: true, starred: true });
      });
    }
  });
});

// Delete entire conversation for current user
router.delete('/conversations/:contactId', authMiddleware, (req, res) => {
  const db = getDb();
  const userId = req.user.userId;
  const { contactId } = req.params;

  const query = `
    UPDATE messages
    SET 
      is_deleted_by_sender = CASE WHEN sender_id = ? THEN 1 ELSE is_deleted_by_sender END,
      is_deleted_by_receiver = CASE WHEN receiver_id = ? THEN 1 ELSE is_deleted_by_receiver END
    WHERE (sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?)
  `;

  db.run(query, [userId, userId, userId, contactId, contactId, userId], function(err) {
    if (err) {
      return res.status(500).json({ error: 'Error deleting conversation' });
    }
    res.json({ success: true });
  });
});

// Get starred messages for a conversation
router.get('/conversations/:contactId/starred', authMiddleware, (req, res) => {
  const db = getDb();
  const userId = req.user.userId;
  const { contactId } = req.params;

  const query = `
    SELECT m.*, sender.username as sender_username, sender.profile_picture as sender_picture,
           sm.starred_at
    FROM starred_messages sm
    JOIN messages m ON sm.message_id = m.id
    JOIN users sender ON m.sender_id = sender.id
    WHERE sm.user_id = ?
      AND ((m.sender_id = ? AND m.receiver_id = ?) OR (m.sender_id = ? AND m.receiver_id = ?))
    ORDER BY sm.starred_at DESC
  `;

  db.all(query, [userId, userId, contactId, contactId, userId], (err, messages) => {
    if (err) {
      return res.status(500).json({ error: 'Error fetching starred messages' });
    }
    res.json({ success: true, messages: messages || [] });
  });
});

// Get media, links and docs for a conversation
router.get('/conversations/:contactId/media', authMiddleware, (req, res) => {
  const db = getDb();
  const userId = req.user.userId;
  const { contactId } = req.params;

  const query = `
    SELECT m.*, sender.username as sender_username
    FROM messages m
    JOIN users sender ON m.sender_id = sender.id
    WHERE ((m.sender_id = ? AND m.receiver_id = ?) OR (m.sender_id = ? AND m.receiver_id = ?))
      AND m.type IN ('image', 'video', 'file', 'gif')
      AND m.is_deleted_by_sender = 0 AND m.is_deleted_by_receiver = 0
    ORDER BY m.created_at DESC
  `;

  db.all(query, [userId, contactId, contactId, userId], (err, messages) => {
    if (err) {
      return res.status(500).json({ error: 'Error fetching media' });
    }
    res.json({ success: true, media: messages || [] });
  });
});

// Search messages in a conversation
router.get('/conversations/:contactId/search', authMiddleware, (req, res) => {
  const db = getDb();
  const userId = req.user.userId;
  const { contactId } = req.params;
  const { q } = req.query;

  if (!q || q.trim().length === 0) {
    return res.json({ success: true, messages: [] });
  }

  const query = `
    SELECT m.*, sender.username as sender_username
    FROM messages m
    JOIN users sender ON m.sender_id = sender.id
    WHERE ((m.sender_id = ? AND m.receiver_id = ?) OR (m.sender_id = ? AND m.receiver_id = ?))
      AND m.content LIKE ?
      AND m.is_deleted_by_sender = 0 AND m.is_deleted_by_receiver = 0
    ORDER BY m.created_at DESC
    LIMIT 50
  `;

  db.all(query, [userId, contactId, contactId, userId, `%${q}%`], (err, messages) => {
    if (err) {
      return res.status(500).json({ error: 'Error searching messages' });
    }
    res.json({ success: true, messages: messages || [] });
  });
});

// Clear chat (soft delete for current user)
router.post('/conversations/:contactId/clear', authMiddleware, (req, res) => {
  const db = getDb();
  const userId = req.user.userId;
  const { contactId } = req.params;

  const query = `
    UPDATE messages
    SET 
      is_deleted_by_sender = CASE WHEN sender_id = ? THEN 1 ELSE is_deleted_by_sender END,
      is_deleted_by_receiver = CASE WHEN receiver_id = ? THEN 1 ELSE is_deleted_by_receiver END
    WHERE (sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?)
  `;

  db.run(query, [userId, userId, userId, contactId, contactId, userId], function(err) {
    if (err) {
      return res.status(500).json({ error: 'Error clearing chat' });
    }
    res.json({ success: true });
  });
});

// Set disappearing messages for a conversation
router.post('/conversations/:contactId/disappearing', authMiddleware, (req, res) => {
  const db = getDb();
  const userId = req.user.userId;
  const { contactId } = req.params;
  const { mode, duration } = req.body; // mode: 'off' | 'timer' | 'on_read', duration: seconds (for timer mode)

  // Store in a simple key-value style using a dedicated table or in-memory
  // For now, we'll use a simple approach with a disappearing_settings table
  db.run(`CREATE TABLE IF NOT EXISTS disappearing_settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    contact_id INTEGER NOT NULL,
    mode TEXT DEFAULT 'off',
    duration INTEGER DEFAULT 0,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, contact_id)
  )`, (err) => {
    if (err) return res.status(500).json({ error: 'DB error' });

    db.run(`INSERT INTO disappearing_settings (user_id, contact_id, mode, duration, updated_at) 
            VALUES (?, ?, ?, ?, datetime('now'))
            ON CONFLICT(user_id, contact_id) DO UPDATE SET mode=?, duration=?, updated_at=datetime('now')`,
      [userId, contactId, mode, duration || 0, mode, duration || 0],
      function(err) {
        if (err) return res.status(500).json({ error: 'Error saving settings' });
        res.json({ success: true, mode, duration });
      }
    );
  });
});

// Get disappearing messages setting
router.get('/conversations/:contactId/disappearing', authMiddleware, (req, res) => {
  const db = getDb();
  const userId = req.user.userId;
  const { contactId } = req.params;

  db.run(`CREATE TABLE IF NOT EXISTS disappearing_settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    contact_id INTEGER NOT NULL,
    mode TEXT DEFAULT 'off',
    duration INTEGER DEFAULT 0,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, contact_id)
  )`, () => {
    db.get('SELECT * FROM disappearing_settings WHERE user_id = ? AND contact_id = ?', [userId, contactId], (err, row) => {
      if (err) return res.status(500).json({ error: 'Error fetching settings' });
      res.json({ success: true, mode: row ? row.mode : 'off', duration: row ? row.duration : 0 });
    });
  });
});

// Toggle chat notifications mute
router.post('/conversations/:contactId/mute', authMiddleware, (req, res) => {
  const db = getDb();
  const userId = req.user.userId;
  const { contactId } = req.params;
  const { muted } = req.body;

  db.run(`CREATE TABLE IF NOT EXISTS chat_mute_settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    contact_id INTEGER NOT NULL,
    muted BOOLEAN DEFAULT 0,
    UNIQUE(user_id, contact_id)
  )`, (err) => {
    if (err) return res.status(500).json({ error: 'DB error' });

    db.run(`INSERT INTO chat_mute_settings (user_id, contact_id, muted) VALUES (?, ?, ?)
            ON CONFLICT(user_id, contact_id) DO UPDATE SET muted=?`,
      [userId, contactId, muted ? 1 : 0, muted ? 1 : 0],
      function(err) {
        if (err) return res.status(500).json({ error: 'Error saving mute setting' });
        res.json({ success: true, muted: !!muted });
      }
    );
  });
});

// Get mute status
router.get('/conversations/:contactId/mute', authMiddleware, (req, res) => {
  const db = getDb();
  const userId = req.user.userId;
  const { contactId } = req.params;

  db.run(`CREATE TABLE IF NOT EXISTS chat_mute_settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    contact_id INTEGER NOT NULL,
    muted BOOLEAN DEFAULT 0,
    UNIQUE(user_id, contact_id)
  )`, () => {
    db.get('SELECT * FROM chat_mute_settings WHERE user_id = ? AND contact_id = ?', [userId, contactId], (err, row) => {
      if (err) return res.status(500).json({ error: 'Error' });
      res.json({ success: true, muted: row ? !!row.muted : false });
    });
  });
});

// Report a user
router.post('/report/:userId', authMiddleware, (req, res) => {
  const db = getDb();
  const reporterId = req.user.userId;
  const { userId } = req.params;
  const { reason, details } = req.body;

  db.run(`CREATE TABLE IF NOT EXISTS user_reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reporter_id INTEGER NOT NULL,
    reported_user_id INTEGER NOT NULL,
    reason TEXT,
    details TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`, (err) => {
    if (err) return res.status(500).json({ error: 'DB error' });

    db.run('INSERT INTO user_reports (reporter_id, reported_user_id, reason, details) VALUES (?, ?, ?, ?)',
      [reporterId, userId, reason || 'other', details || ''],
      function(err) {
        if (err) return res.status(500).json({ error: 'Error submitting report' });
        res.json({ success: true, message: 'Report submitted successfully' });
      }
    );
  });
});

module.exports = router;