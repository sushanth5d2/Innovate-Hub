const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const upload = require('../middleware/upload');
const asyncHandler = require('../middleware/asyncHandler');
const { getDb } = require('../config/database');
const { encrypt: encryptMsg, decrypt: decryptMsg, decryptRows } = require('../services/message-encryption');

// Get conversations list
router.get('/conversations', authMiddleware, asyncHandler((req, res) => {
  const db = getDb();
  const userId = req.user.userId;

  // Get conversations from both messages and user_conversations table
  // user_conversations persists even when messages are cleared
  const query = `
    WITH all_contacts AS (
      SELECT DISTINCT
        CASE 
          WHEN sender_id = ? THEN receiver_id
          ELSE sender_id
        END as contact_id
      FROM messages
      WHERE (sender_id = ? OR receiver_id = ?)
        AND (is_deleted_by_sender = 0 OR sender_id != ?)
        AND (is_deleted_by_receiver = 0 OR receiver_id != ?)
        AND (is_message_request = 0 OR message_request_status = 'accepted')
      UNION
      SELECT contact_id FROM user_conversations WHERE user_id = ?
    ),
    contact_last_msg AS (
      SELECT 
        ac.contact_id,
        MAX(m.id) as last_message_id
      FROM all_contacts ac
      LEFT JOIN messages m ON (
        ((m.sender_id = ? AND m.receiver_id = ac.contact_id) OR (m.sender_id = ac.contact_id AND m.receiver_id = ?))
        AND (m.is_deleted_by_sender = 0 OR m.sender_id != ?)
        AND (m.is_deleted_by_receiver = 0 OR m.receiver_id != ?)
      )
      GROUP BY ac.contact_id
    )
    SELECT 
      cm.contact_id,
      u.username,
      u.profile_picture,
      u.is_online,
      u.last_seen,
      b1.id as b1_id,
      b2.id as b2_id,
      m.content as last_message,
      m.type as last_message_type,
      m.original_filename as last_message_filename,
      m.created_at as last_message_time,
      (SELECT COUNT(*) FROM messages 
       WHERE sender_id = cm.contact_id 
       AND receiver_id = ? 
       AND is_read = 0) as unread_count
    FROM contact_last_msg cm
    JOIN users u ON u.id = cm.contact_id
    LEFT JOIN messages m ON m.id = cm.last_message_id
    LEFT JOIN blocked_users b1 ON (b1.blocker_id = ? AND b1.blocked_id = cm.contact_id)
    LEFT JOIN blocked_users b2 ON (b2.blocker_id = cm.contact_id AND b2.blocked_id = ?)
    ORDER BY COALESCE(m.created_at, '1970-01-01') DESC
  `;

  db.all(query, [userId, userId, userId, userId, userId, userId, userId, userId, userId, userId, userId, userId, userId], (err, rows) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: 'Error fetching conversations' });
    }
    const conversations = rows.map(c => ({
      ...c,
      last_message: decryptMsg(c.last_message),
      is_blocked: (c.b1_id !== null || c.b2_id !== null) ? 1 : 0
    }));
    res.json({ success: true, conversations });
  });
}));

// Get messages with a specific user
router.get('/:contactId', authMiddleware, asyncHandler((req, res) => {
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
      AND (m.expires_at IS NULL OR m.expires_at > CURRENT_TIMESTAMP)
    ORDER BY m.created_at ASC
  `;

  db.all(query, [userId, userId, contactId, contactId, userId], (err, messages) => {
    if (err) {
      return res.status(500).json({ error: 'Error fetching messages' });
    }

    // Delete expired messages from DB
    db.run(
      `DELETE FROM messages WHERE ((sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?)) AND expires_at IS NOT NULL AND expires_at <= CURRENT_TIMESTAMP`,
      [userId, contactId, contactId, userId]
    );

    // Count unread messages BEFORE marking as read (messages from contact that are unread)
    const unreadCount = messages.filter(m => m.sender_id == contactId && !m.is_read).length;
    // Find ID of first unread message
    const firstUnread = messages.find(m => m.sender_id == contactId && !m.is_read);
    const firstUnreadId = firstUnread ? firstUnread.id : null;

    // Mark messages as read and set timestamps
    db.run(
      'UPDATE messages SET is_read = 1, delivered_at = COALESCE(delivered_at, CURRENT_TIMESTAMP), read_at = COALESCE(read_at, CURRENT_TIMESTAMP) WHERE sender_id = ? AND receiver_id = ? AND is_read = 0',
      [contactId, userId]
    );

    messages = messages.map(msg => ({
      ...msg,
      content: decryptMsg(msg.content),
      attachments: msg.attachments ? JSON.parse(msg.attachments) : []
    }));

    // Check if this is a message request conversation (any pending message request from this contact)
    const hasMessageRequest = messages.some(m => m.is_message_request === 1 && m.message_request_status === 'pending' && m.sender_id == contactId);

    res.json({ success: true, messages, is_message_request: hasMessageRequest, unread_count: unreadCount, first_unread_id: firstUnreadId });
  });
}));

// Send message
router.post('/send', authMiddleware, asyncHandler((req, res, next) => {
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

    // Input validation
    if (content && typeof content === 'string' && content.length > 10000) {
      return res.status(400).json({ error: 'Message exceeds maximum length (10000 chars)' });
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

    // Check if receiver has a private account and sender is not a follower
    // If so, mark the message as a message request
    let isMessageRequest = 0;
    let messageRequestStatus = null;

    // Auto-apply conversation disappearing settings if no per-message timer
    const applyDisappearingAndSend = () => {
      if (!expiresAt) {
        db.get(
          `SELECT mode, duration FROM disappearing_settings WHERE (user_id = ? AND contact_id = ?) OR (user_id = ? AND contact_id = ?) ORDER BY updated_at DESC LIMIT 1`,
          [senderId, receiver_id, receiver_id, senderId],
          (dsErr, dsSetting) => {
            if (!dsErr && dsSetting && dsSetting.mode === 'timer' && dsSetting.duration > 0) {
              const now = new Date();
              now.setSeconds(now.getSeconds() + dsSetting.duration);
              expiresAt = now.toISOString();
            }
            proceedWithBlockCheck();
          }
        );
      } else {
        proceedWithBlockCheck();
      }
    };

    const proceedWithBlockCheck = () => {
    // Check if either user has blocked the other
    db.get(
      'SELECT id FROM blocked_users WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)',
      [senderId, receiver_id, receiver_id, senderId],
      (blockErr, blocked) => {
        if (blocked) {
          return res.status(403).json({ error: 'Cannot send message to this user' });
        }

    const checkAndSend = () => {
      const query = `
        INSERT INTO messages (sender_id, receiver_id, content, type, timer, expires_at, original_filename, is_message_request, message_request_status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `;

      db.run(query, [senderId, receiver_id, encryptMsg(messageContent), messageType, timer || null, expiresAt, originalFilename, isMessageRequest, messageRequestStatus], function(err) {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).json({ error: 'Error sending message' });
      }

      const messageId = this.lastID;

      // Track conversation for both users (persists after clear/disappear)
      db.run(`INSERT INTO user_conversations (user_id, contact_id) VALUES (?, ?) ON CONFLICT (user_id, contact_id) DO NOTHING`, [senderId, receiver_id]);
      db.run(`INSERT INTO user_conversations (user_id, contact_id) VALUES (?, ?) ON CONFLICT (user_id, contact_id) DO NOTHING`, [receiver_id, senderId]);

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
          is_message_request: isMessageRequest,
          message_request_status: messageRequestStatus,
          created_at: new Date().toISOString()
        };

        // Emit socket event
        const io = req.app.get('io');
        io.to(`user_${receiver_id}`).emit('new_message', messageData);
        io.to(`user_${senderId}`).emit('new_message', { ...messageData, is_own: true });

        // Create notification
        const notifType = isMessageRequest ? 'message_request' : 'message';
        db.run(
          `INSERT INTO notifications (user_id, type, content, related_id, created_by, created_at)
           VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
          [receiver_id, notifType, `New message from ${sender.username}`, messageId, senderId]
        );

        var msgNotif = {
          type: notifType,
          content: messageContent || 'sent you a message',
          created_by: senderId,
          username: sender.username,
          profile_picture: sender.profile_picture,
          sender_id: senderId,
          receiver_id: receiver_id,
          created_at: new Date().toISOString()
        };
        io.to(`user_${receiver_id}`).emit('notification:receive', msgNotif);

        res.json({ success: true, message: messageData });
      }
    );
  });
    }; // end of checkAndSend

    // Check receiver's privacy setting
    db.get('SELECT is_private FROM users WHERE id = ?', [receiver_id], (err, receiverUser) => {
      if (err || !receiverUser) {
        return checkAndSend(); // proceed anyway if user lookup fails
      }

      if (receiverUser.is_private) {
        // Check if sender follows the receiver (i.e., receiver accepted them)
        db.get('SELECT id FROM followers WHERE follower_id = ? AND following_id = ?', [senderId, receiver_id], (err, follow) => {
          if (!follow) {
            // Check if there were any previous accepted messages between them
            db.get(`SELECT id FROM messages WHERE 
              ((sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?))
              AND is_message_request = 0
              LIMIT 1`, [senderId, receiver_id, receiver_id, senderId], (err, existingConvo) => {
              if (!existingConvo) {
                // No existing conversation and not a follower — it's a message request
                isMessageRequest = 1;
                messageRequestStatus = 'pending';
              }
              checkAndSend();
            });
          } else {
            checkAndSend();
          }
        });
      } else {
        checkAndSend();
      }
    });

  }); // end blocked check
  }; // end proceedWithBlockCheck

  applyDisappearingAndSend();
  });
}));

// ===== MESSAGE REQUESTS =====

// Get message requests (messages from non-followers to private accounts)
router.get('/requests/list', authMiddleware, asyncHandler((req, res) => {
  const db = getDb();
  const userId = req.user.userId;

  // Get unique senders who have sent message requests to this user
  const query = `
    WITH request_senders AS (
      SELECT 
        sender_id,
        MAX(id) as last_message_id,
        COUNT(*) as message_count
      FROM messages
      WHERE receiver_id = ? AND is_message_request = 1 AND message_request_status = 'pending'
      GROUP BY sender_id
    )
    SELECT 
      rs.sender_id as contact_id,
      u.username,
      u.profile_picture,
      m.content as last_message,
      m.type as last_message_type,
      m.created_at as last_message_time,
      rs.message_count
    FROM request_senders rs
    JOIN users u ON u.id = rs.sender_id
    LEFT JOIN messages m ON m.id = rs.last_message_id
    ORDER BY m.created_at DESC
  `;

  db.all(query, [userId], (err, requests) => {
    if (err) {
      return res.status(500).json({ error: 'Error fetching message requests' });
    }
    res.json({ success: true, requests: requests || [] });
  });
}));

// Get message requests count
router.get('/requests/count', authMiddleware, asyncHandler((req, res) => {
  const db = getDb();
  const userId = req.user.userId;

  db.get(`
    SELECT COUNT(DISTINCT sender_id) as count 
    FROM messages 
    WHERE receiver_id = ? AND is_message_request = 1 AND message_request_status = 'pending'
  `, [userId], (err, result) => {
    if (err) {
      return res.status(500).json({ error: 'Error fetching count' });
    }
    res.json({ success: true, count: result ? result.count : 0 });
  });
}));

// Accept message request (move to regular inbox)
router.post('/requests/:senderId/accept', authMiddleware, asyncHandler((req, res) => {
  const db = getDb();
  const userId = req.user.userId;
  const senderId = parseInt(req.params.senderId);

  db.run(`
    UPDATE messages SET is_message_request = 0, message_request_status = 'accepted'
    WHERE sender_id = ? AND receiver_id = ? AND is_message_request = 1
  `, [senderId, userId], function(err) {
    if (err) {
      return res.status(500).json({ error: 'Error accepting message request' });
    }
    res.json({ success: true });
  });
}));

// Delete message request
router.delete('/requests/:senderId', authMiddleware, asyncHandler((req, res) => {
  const db = getDb();
  const userId = req.user.userId;
  const senderId = parseInt(req.params.senderId);

  db.run(`
    UPDATE messages SET message_request_status = 'declined'
    WHERE sender_id = ? AND receiver_id = ? AND is_message_request = 1
  `, [senderId, userId], function(err) {
    if (err) {
      return res.status(500).json({ error: 'Error deleting message request' });
    }
    res.json({ success: true });
  });
}));

// Original send endpoint for backward compatibility
router.post('/', authMiddleware, upload.array('attachments', 5), asyncHandler((req, res) => {
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

  // Auto-apply conversation disappearing settings if no per-message timer
  const startSendFlow = () => {
    if (!expiresAt && receiver_id) {
      db.get(
        `SELECT mode, duration FROM disappearing_settings WHERE (user_id = ? AND contact_id = ?) OR (user_id = ? AND contact_id = ?) ORDER BY updated_at DESC LIMIT 1`,
        [senderId, receiver_id, receiver_id, senderId],
        (dsErr, dsSetting) => {
          if (!dsErr && dsSetting && dsSetting.mode === 'timer' && dsSetting.duration > 0) {
            const now = new Date();
            now.setSeconds(now.getSeconds() + dsSetting.duration);
            expiresAt = now.toISOString();
          }
          doPrivacyCheckAndSend();
        }
      );
    } else {
      doPrivacyCheckAndSend();
    }
  };

  // Check if receiver has a private account and sender is not a follower
  const insertMessage = (isMessageRequest, messageRequestStatus) => {
    const query = `
      INSERT INTO messages (sender_id, receiver_id, content, attachments, timer, expires_at, reply_to_id, is_message_request, message_request_status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    db.run(query, [senderId, receiver_id, encryptMsg(content), JSON.stringify(attachments), timer || null, expiresAt, reply_to_id || null, isMessageRequest, messageRequestStatus], function(err) {
      if (err) {
        return res.status(500).json({ error: 'Error sending message' });
      }

      const messageId = this.lastID;

      // Track conversation for both users (persists after clear/disappear)
      db.run(`INSERT INTO user_conversations (user_id, contact_id) VALUES (?, ?) ON CONFLICT (user_id, contact_id) DO NOTHING`, [senderId, receiver_id]);
      db.run(`INSERT INTO user_conversations (user_id, contact_id) VALUES (?, ?) ON CONFLICT (user_id, contact_id) DO NOTHING`, [receiver_id, senderId]);

      // Create notification
      db.run(
        'INSERT INTO notifications (user_id, type, content, related_id, created_by) VALUES (?, ?, ?, ?, ?)',
        [receiver_id, isMessageRequest ? 'message_request' : 'message', 'sent you a message', messageId, senderId]
      );

      // Emit socket event
      const io = req.app.get('io');
      const messageData = {
        id: messageId,
        sender_id: senderId,
        receiver_id,
        content,
        attachments,
        timer: timer || null,
        expires_at: expiresAt,
        is_message_request: isMessageRequest,
        message_request_status: messageRequestStatus,
        created_at: new Date().toISOString()
      };

      io.to(`user_${receiver_id}`).emit('new_message', messageData);
      io.to(`user_${senderId}`).emit('new_message', { ...messageData, is_own: true });

      // Emit notification:receive for notification banners (with sender info)
      db.get('SELECT username, profile_picture FROM users WHERE id = ?', [senderId], (e2, senderInfo) => {
        io.to(`user_${receiver_id}`).emit('notification:receive', {
          type: isMessageRequest ? 'message_request' : 'message',
          content: content || 'sent you a message',
          created_by: senderId,
          username: senderInfo ? senderInfo.username : '',
          profile_picture: senderInfo ? senderInfo.profile_picture : '',
          sender_id: senderId,
          receiver_id: receiver_id,
          created_at: new Date().toISOString()
        });
      });

      res.json({
        success: true,
        message: messageData
      });
    });
  };

  const doPrivacyCheckAndSend = () => {
  // Check receiver's privacy setting
  db.get('SELECT is_private FROM users WHERE id = ?', [receiver_id], (err, receiverUser) => {
    if (err || !receiverUser) {
      return insertMessage(0, null);
    }

    if (receiverUser.is_private) {
      // Check if sender follows the receiver (receiver accepted them)
      db.get('SELECT id FROM followers WHERE follower_id = ? AND following_id = ?', [senderId, receiver_id], (err, follow) => {
        if (!follow) {
          // Check if there's an existing accepted conversation
          db.get(`SELECT id FROM messages WHERE 
            ((sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?))
            AND is_message_request = 0
            LIMIT 1`, [senderId, receiver_id, receiver_id, senderId], (err, existingConvo) => {
            if (!existingConvo) {
              // Not a follower and no existing conversation — message request
              insertMessage(1, 'pending');
            } else {
              insertMessage(0, null);
            }
          });
        } else {
          insertMessage(0, null);
        }
      });
    } else {
      insertMessage(0, null);
    }
  });
  }; // end doPrivacyCheckAndSend

  startSendFlow();
}));

// Edit message
router.put('/:messageId', authMiddleware, upload.single('file'), asyncHandler((req, res) => {
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

      const encryptedFilePath = encryptMsg(newFilePath);

      db.run(
        updateQuery,
        [encryptedFilePath, newType, newOriginalFilename, messageId, userId],
        function(err) {
          if (err) {
            console.error('Update error:', err);
            return res.status(500).json({ error: 'Error editing message' });
          }
          if (this.changes === 0) {
            return res.status(404).json({ error: 'Message not found or unauthorized' });
          }

          // Emit socket event for real-time update (send plaintext)
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
}));

// Get message info (sent, delivered, read times)
router.get('/:messageId/info', authMiddleware, asyncHandler((req, res) => {
  const db = getDb();
  const userId = req.user.userId;
  const { messageId } = req.params;

  db.get(
    'SELECT id, sender_id, receiver_id, content, type, created_at, delivered_at, read_at, is_read FROM messages WHERE id = ? AND (sender_id = ? OR receiver_id = ?)',
    [messageId, userId, userId],
    (err, message) => {
      if (err) {
        return res.status(500).json({ error: 'Error fetching message info' });
      }
      if (!message) {
        return res.status(404).json({ error: 'Message not found' });
      }
      message.content = decryptMsg(message.content);
      res.json({ success: true, message });
    }
  );
}));

// Unsend message (delete for both)
router.delete('/:messageId/unsend', authMiddleware, asyncHandler((req, res) => {
  const db = getDb();
  const userId = req.user.userId;
  const { messageId } = req.params;

  // Get message first to know the receiver
  db.get('SELECT receiver_id FROM messages WHERE id = ? AND sender_id = ?', [messageId, userId], (findErr, msg) => {
    if (findErr || !msg) {
      return res.status(404).json({ error: 'Message not found or unauthorized' });
    }
    const receiverId = msg.receiver_id;

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

        // Notify the other user in real-time
        const io = req.app.get('io');
        if (io) {
          io.to(`user_${receiverId}`).emit('message:unsend', { messageId, senderId: userId });
        }

        res.json({ success: true });
      }
    );
  });
}));

// Delete message (for self only)
router.delete('/:messageId', authMiddleware, asyncHandler((req, res) => {
  const db = getDb();
  const userId = req.user.userId;
  const { messageId } = req.params;

  // Check if user is sender or receiver
  db.get('SELECT * FROM messages WHERE id = ?', [messageId], (err, message) => {
    if (err || !message) {
      return res.status(404).json({ error: 'Message not found' });
    }

    if (message.sender_id == userId) {
      db.run('UPDATE messages SET is_deleted_by_sender = TRUE WHERE id = ?', [messageId]);
    } else if (message.receiver_id == userId) {
      db.run('UPDATE messages SET is_deleted_by_receiver = TRUE WHERE id = ?', [messageId]);
    } else {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    res.json({ success: true });
  });
}));

// Pin/Unpin a message
router.post('/:messageId/pin', authMiddleware, asyncHandler((req, res) => {
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
      if (pinDuration !== null && pinDuration !== undefined && pinDuration !== 'forever') {
        const days = parseInt(pinDuration);
        if (!isNaN(days) && days > 0) {
          // Calculate expiry time
          const expiryDate = new Date();
          expiryDate.setDate(expiryDate.getDate() + days);
          pinExpiry = expiryDate.toISOString();
        }
        // If NaN or 0, pin indefinitely (null expiry)
      }
      
      const updateQuery = `
        UPDATE messages 
        SET is_pinned = 1,
            pinned_at = CURRENT_TIMESTAMP,
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
}));

// Star/Favorite a message
router.post('/:messageId/star', authMiddleware, asyncHandler((req, res) => {
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
      db.run('INSERT INTO starred_messages (user_id, message_id, starred_at) VALUES (?, ?, CURRENT_TIMESTAMP)', 
        [userId, messageId], 
        function(err) {
          if (err) {
            return res.status(500).json({ error: 'Error adding star' });
          }
          res.json({ success: true, starred: true });
      });
    }
  });
}));

// Delete entire conversation for current user
router.delete('/conversations/:contactId', authMiddleware, asyncHandler((req, res) => {
  const db = getDb();
  const userId = req.user.userId;
  const { contactId } = req.params;

  const query = `
    UPDATE messages
    SET 
      is_deleted_by_sender = CASE WHEN sender_id = ? THEN TRUE ELSE is_deleted_by_sender END,
      is_deleted_by_receiver = CASE WHEN receiver_id = ? THEN TRUE ELSE is_deleted_by_receiver END
    WHERE (sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?)
  `;

  db.run(query, [userId, userId, userId, contactId, contactId, userId], function(err) {
    if (err) {
      return res.status(500).json({ error: 'Error deleting conversation' });
    }
    // Remove from user_conversations so it disappears from the list
    db.run(`DELETE FROM user_conversations WHERE user_id = ? AND contact_id = ?`, [userId, contactId]);
    res.json({ success: true });
  });
}));
router.get('/conversations/:contactId/starred', authMiddleware, asyncHandler((req, res) => {
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
    res.json({ success: true, messages: decryptRows(messages || []) });
  });
}));

// Get media, links and docs for a conversation
router.get('/conversations/:contactId/media', authMiddleware, asyncHandler((req, res) => {
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
    res.json({ success: true, media: decryptRows(messages || []) });
  });
}));

// Search messages in a conversation
router.get('/conversations/:contactId/search', authMiddleware, asyncHandler((req, res) => {
  const db = getDb();
  const userId = req.user.userId;
  const { contactId } = req.params;
  const { q } = req.query;

  if (!q || q.trim().length === 0) {
    return res.json({ success: true, messages: [] });
  }

  // Fetch all conversation messages and filter after decryption (encrypted content can't be searched with LIKE)
  const query = `
    SELECT m.*, sender.username as sender_username
    FROM messages m
    JOIN users sender ON m.sender_id = sender.id
    WHERE ((m.sender_id = ? AND m.receiver_id = ?) OR (m.sender_id = ? AND m.receiver_id = ?))
      AND m.is_deleted_by_sender = 0 AND m.is_deleted_by_receiver = 0
    ORDER BY m.created_at DESC
  `;

  db.all(query, [userId, contactId, contactId, userId], (err, messages) => {
    if (err) {
      return res.status(500).json({ error: 'Error searching messages' });
    }
    const decrypted = decryptRows(messages || []);
    const searchLower = q.toLowerCase();
    const filtered = decrypted.filter(m => m.content && m.content.toLowerCase().includes(searchLower)).slice(0, 50);
    res.json({ success: true, messages: filtered });
  });
}));

// Clear chat (soft delete for current user)
router.post('/conversations/:contactId/clear', authMiddleware, asyncHandler((req, res) => {
  const db = getDb();
  const userId = req.user.userId;
  const { contactId } = req.params;

  const query = `
    UPDATE messages
    SET 
      is_deleted_by_sender = CASE WHEN sender_id = ? THEN TRUE ELSE is_deleted_by_sender END,
      is_deleted_by_receiver = CASE WHEN receiver_id = ? THEN TRUE ELSE is_deleted_by_receiver END
    WHERE (sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?)
  `;

  db.run(query, [userId, userId, userId, contactId, contactId, userId], function(err) {
    if (err) {
      return res.status(500).json({ error: 'Error clearing chat' });
    }
    res.json({ success: true });
  });
}));

// Clear chat for everyone (permanently delete all messages in conversation)
router.post('/conversations/:contactId/clear-all', authMiddleware, asyncHandler((req, res) => {
  const db = getDb();
  const userId = req.user.userId;
  const { contactId } = req.params;

  db.run(
    `DELETE FROM messages WHERE (sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?)`,
    [userId, contactId, contactId, userId],
    function(err) {
      if (err) {
        return res.status(500).json({ error: 'Error clearing chat for everyone' });
      }
      res.json({ success: true, deleted: this.changes });
    }
  );
}));

// Delete chat for everyone (permanently delete entire conversation)
router.delete('/conversations/:contactId/delete-all', authMiddleware, asyncHandler((req, res) => {
  const db = getDb();
  const userId = req.user.userId;
  const { contactId } = req.params;

  db.run(
    `DELETE FROM messages WHERE (sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?)`,
    [userId, contactId, contactId, userId],
    function(err) {
      if (err) {
        return res.status(500).json({ error: 'Error deleting chat for everyone' });
      }
      // Remove from user_conversations for both users so it disappears from both lists
      db.run(`DELETE FROM user_conversations WHERE (user_id = ? AND contact_id = ?) OR (user_id = ? AND contact_id = ?)`, [userId, contactId, contactId, userId]);
      res.json({ success: true, deleted: this.changes });
    }
  );
}));

// Set disappearing messages for a conversation
router.post('/conversations/:contactId/disappearing', authMiddleware, asyncHandler((req, res) => {
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
            VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(user_id, contact_id) DO UPDATE SET mode=?, duration=?, updated_at=CURRENT_TIMESTAMP`,
      [userId, contactId, mode, duration || 0, mode, duration || 0],
      function(err) {
        if (err) return res.status(500).json({ error: 'Error saving settings' });
        // Also save the same setting for the other user so it's shared
        db.run(`INSERT INTO disappearing_settings (user_id, contact_id, mode, duration, updated_at) 
                VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
                ON CONFLICT(user_id, contact_id) DO UPDATE SET mode=?, duration=?, updated_at=CURRENT_TIMESTAMP`,
          [contactId, userId, mode, duration || 0, mode, duration || 0],
          function(err2) {
            if (err2) console.error('Error syncing disappearing setting for other user:', err2);
            // Notify the other user via socket so their UI updates
            const io = req.app.get('io');
            if (io) {
              io.to(`user-${contactId}`).emit('disappearing:updated', { contactId: userId, mode, duration: duration || 0 });
            }
            res.json({ success: true, mode, duration });
          }
        );
      }
    );
  });
}));

// Get disappearing messages setting
router.get('/conversations/:contactId/disappearing', authMiddleware, asyncHandler((req, res) => {
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
    db.get('SELECT * FROM disappearing_settings WHERE (user_id = ? AND contact_id = ?) OR (user_id = ? AND contact_id = ?) ORDER BY updated_at DESC LIMIT 1', [userId, contactId, contactId, userId], (err, row) => {
      if (err) return res.status(500).json({ error: 'Error fetching settings' });
      res.json({ success: true, mode: row ? row.mode : 'off', duration: row ? row.duration : 0 });
    });
  });
}));

// Leave chat - handle disappear-on-exit mode (delete read messages when user exits the chat)
router.post('/conversations/:contactId/leave', authMiddleware, asyncHandler((req, res) => {
  const db = getDb();
  const userId = req.user.userId;
  const { contactId } = req.params;

  db.get(
    `SELECT mode FROM disappearing_settings WHERE (user_id = ? AND contact_id = ?) OR (user_id = ? AND contact_id = ?) ORDER BY updated_at DESC LIMIT 1`,
    [userId, contactId, contactId, userId],
    (dsErr, dsSetting) => {
      if (!dsErr && dsSetting && dsSetting.mode === 'on_read') {
        // Soft-delete: mark messages as deleted for the exiting user only
        // Messages sent BY this user: mark is_deleted_by_sender
        db.run(
          `UPDATE messages SET is_deleted_by_sender = 1 WHERE sender_id = ? AND receiver_id = ? AND is_read = 1`,
          [userId, contactId],
          function(err1) {
            if (err1) console.error('Error soft-deleting sent messages:', err1);
            const sentDeleted = this.changes || 0;
            // Messages received BY this user: mark is_deleted_by_receiver
            db.run(
              `UPDATE messages SET is_deleted_by_receiver = 1 WHERE sender_id = ? AND receiver_id = ? AND is_read = 1`,
              [contactId, userId],
              function(err2) {
                if (err2) console.error('Error soft-deleting received messages:', err2);
                res.json({ success: true, deleted: sentDeleted + (this.changes || 0) });
              }
            );
          }
        );
      } else {
        res.json({ success: true, deleted: 0 });
      }
    }
  );
}));

// Toggle chat notifications mute
router.post('/conversations/:contactId/mute', authMiddleware, asyncHandler((req, res) => {
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
}));

// Get mute status
router.get('/conversations/:contactId/mute', authMiddleware, asyncHandler((req, res) => {
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
}));

// Report a user
router.post('/report/:userId', authMiddleware, asyncHandler((req, res) => {
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
}));

// Toggle a TODO item's checked state in a message
router.patch('/:messageId/todo-toggle', authMiddleware, (req, res) => {
  const db = getDb();
  const userId = req.user.userId;
  const { messageId } = req.params;
  const { itemIndex } = req.body;

  if (itemIndex === undefined || itemIndex === null) {
    return res.status(400).json({ error: 'itemIndex is required' });
  }

  db.get('SELECT * FROM messages WHERE id = ? AND (sender_id = ? OR receiver_id = ?)',
    [messageId, userId, userId],
    (err, msg) => {
      if (err || !msg) return res.status(404).json({ error: 'Message not found' });
      if (msg.type !== 'todo') return res.status(400).json({ error: 'Not a todo message' });

      try {
        const todo = JSON.parse(decryptMsg(msg.content) || '{}');
        const items = todo.items || [];
        const idx = parseInt(itemIndex);
        if (idx < 0 || idx >= items.length) {
          return res.status(400).json({ error: 'Invalid item index' });
        }
        items[idx].checked = !items[idx].checked;
        todo.items = items;

        db.run('UPDATE messages SET content = ? WHERE id = ?',
          [encryptMsg(JSON.stringify(todo)), messageId],
          function(updateErr) {
            if (updateErr) return res.status(500).json({ error: 'Failed to update' });

            // Also update the linked task in shared_tasks table if exists
            if (todo.shared_task_id) {
              const subtasks = items.map(i => ({ text: i.text, completed: i.checked }));
              const allDone = subtasks.length > 0 && subtasks.every(i => i.completed);
              const doneCount = subtasks.filter(i => i.completed).length;
              const progress = subtasks.length > 0 ? Math.round((doneCount / subtasks.length) * 100) : 0;
              db.run('UPDATE shared_tasks SET subtasks = ?, status = ?, progress = ? WHERE id = ?',
                [JSON.stringify(subtasks), allDone ? 'done' : 'in_progress', progress, todo.shared_task_id],
                () => {}
              );
            } else if (todo.todo_id) {
              // Legacy: sync with old todos table
              const todoItems = items.map(i => ({ text: i.text, completed: i.checked }));
              const allDone = todoItems.every(i => i.completed);
              db.run('UPDATE todos SET items = ?, completed = ? WHERE id = ?',
                [JSON.stringify(todoItems), allDone ? true : false, todo.todo_id],
                () => {}
              );
            }

            res.json({ success: true, items });
          }
        );
      } catch (_) {
        res.status(400).json({ error: 'Invalid todo data' });
      }
    }
  );
});

module.exports = router;