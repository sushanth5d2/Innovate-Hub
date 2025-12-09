const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const upload = require('../middleware/upload');
const { getDb } = require('../config/database');

// Get conversations list
router.get('/conversations', authMiddleware, (req, res) => {
  const db = getDb();
  const userId = req.user.userId;

  const query = `
    SELECT DISTINCT
      CASE 
        WHEN m.sender_id = ? THEN m.receiver_id
        ELSE m.sender_id
      END as contact_id,
      u.username,
      u.profile_picture,
      u.is_online,
      u.last_seen,
      (SELECT content FROM messages 
       WHERE (sender_id = ? AND receiver_id = CASE WHEN m.sender_id = ? THEN m.receiver_id ELSE m.sender_id END) 
          OR (sender_id = CASE WHEN m.sender_id = ? THEN m.receiver_id ELSE m.sender_id END AND receiver_id = ?)
       ORDER BY created_at DESC LIMIT 1) as last_message,
      (SELECT created_at FROM messages 
       WHERE (sender_id = ? AND receiver_id = CASE WHEN m.sender_id = ? THEN m.receiver_id ELSE m.sender_id END) 
          OR (sender_id = CASE WHEN m.sender_id = ? THEN m.receiver_id ELSE m.sender_id END AND receiver_id = ?)
       ORDER BY created_at DESC LIMIT 1) as last_message_time,
      (SELECT COUNT(*) FROM messages 
       WHERE sender_id = CASE WHEN m.sender_id = ? THEN m.receiver_id ELSE m.sender_id END AND receiver_id = ? AND is_read = 0) as unread_count
    FROM messages m
    JOIN users u ON u.id = CASE 
      WHEN m.sender_id = ? THEN m.receiver_id
      ELSE m.sender_id
    END
    WHERE (m.sender_id = ? OR m.receiver_id = ?)
      AND (m.is_deleted_by_sender = 0 OR m.sender_id != ?)
      AND (m.is_deleted_by_receiver = 0 OR m.receiver_id != ?)
    ORDER BY last_message_time DESC
  `;

  db.all(query, [userId, userId, userId, userId, userId, userId, userId, userId, userId, userId, userId, userId, userId, userId], (err, conversations) => {
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
           sender.profile_picture as sender_picture
    FROM messages m
    JOIN users sender ON m.sender_id = sender.id
    WHERE ((m.sender_id = ? AND m.receiver_id = ? AND m.is_deleted_by_sender = 0)
       OR (m.sender_id = ? AND m.receiver_id = ? AND m.is_deleted_by_receiver = 0))
    ORDER BY m.created_at ASC
  `;

  db.all(query, [userId, contactId, contactId, userId], (err, messages) => {
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
router.post('/', authMiddleware, upload.array('attachments', 5), (req, res) => {
  const db = getDb();
  const senderId = req.user.userId;
  const { receiver_id, content } = req.body;

  let attachments = [];
  if (req.files) {
    attachments = req.files.map(file => ({
      name: file.originalname,
      path: file.mimetype.startsWith('image/') ? `/uploads/images/${file.filename}` : `/uploads/files/${file.filename}`,
      type: file.mimetype,
      size: file.size
    }));
  }

  const query = `
    INSERT INTO messages (sender_id, receiver_id, content, attachments)
    VALUES (?, ?, ?, ?)
  `;

  db.run(query, [senderId, receiver_id, content, JSON.stringify(attachments)], function(err) {
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
        created_at: new Date().toISOString()
      }
    });
  });
});

// Edit message
router.put('/:messageId', authMiddleware, (req, res) => {
  const db = getDb();
  const userId = req.user.userId;
  const { messageId } = req.params;
  const { content } = req.body;

  db.run(
    'UPDATE messages SET content = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND sender_id = ?',
    [content, messageId, userId],
    function(err) {
      if (err) {
        return res.status(500).json({ error: 'Error editing message' });
      }
      if (this.changes === 0) {
        return res.status(404).json({ error: 'Message not found or unauthorized' });
      }
      res.json({ success: true });
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

module.exports = router;
