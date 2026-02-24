const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const { getDb } = require('../config/database');

// Get all notifications
router.get('/', authMiddleware, (req, res) => {
  const db = getDb();
  const userId = req.user.userId;

  const query = `
    SELECT n.*,
           u.username, u.profile_picture
    FROM notifications n
    LEFT JOIN users u ON (
      (n.created_by IS NOT NULL AND u.id = n.created_by)
      OR (
        n.created_by IS NULL
        AND n.type IN ('follow', 'follow_request', 'follow_accepted', 'message', 'crosspath', 'crosspath_accepted', 'crosspath_match', 'community_join')
        AND u.id = n.related_id
      )
    )
    WHERE n.user_id = ?
    ORDER BY n.created_at DESC
    LIMIT 100
  `;

  db.all(query, [userId], (err, notifications) => {
    if (err) {
      return res.status(500).json({ error: 'Error fetching notifications' });
    }
    res.json({ success: true, notifications });
  });
});

// Mark notification as read
router.put('/:notificationId/read', authMiddleware, (req, res) => {
  const db = getDb();
  const userId = req.user.userId;
  const { notificationId } = req.params;

  db.run(
    'UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?',
    [notificationId, userId],
    function(err) {
      if (err) {
        return res.status(500).json({ error: 'Error marking notification as read' });
      }
      res.json({ success: true });
    }
  );
});

// Mark all as read
router.put('/read/all', authMiddleware, (req, res) => {
  const db = getDb();
  const userId = req.user.userId;

  db.run(
    'UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0',
    [userId],
    function(err) {
      if (err) {
        return res.status(500).json({ error: 'Error marking all notifications as read' });
      }
      res.json({ success: true });
    }
  );
});

// Delete all notifications (must come before /:notificationId route)
router.delete('/clear/all', authMiddleware, (req, res) => {
  const db = getDb();
  const userId = req.user.userId;

  db.run(
    'DELETE FROM notifications WHERE user_id = ?',
    [userId],
    function(err) {
      if (err) {
        return res.status(500).json({ error: 'Error clearing notifications' });
      }
      res.json({ success: true, deleted: this.changes });
    }
  );
});

// Delete notification
router.delete('/:notificationId', authMiddleware, (req, res) => {
  const db = getDb();
  const userId = req.user.userId;
  const { notificationId } = req.params;

  db.run(
    'DELETE FROM notifications WHERE id = ? AND user_id = ?',
    [notificationId, userId],
    function(err) {
      if (err) {
        return res.status(500).json({ error: 'Error deleting notification' });
      }
      res.json({ success: true });
    }
  );
});

// Clean duplicate join request notifications
router.post('/cleanup/duplicates', authMiddleware, (req, res) => {
  const db = getDb();
  const userId = req.user.userId;

  // Remove duplicate join_request notifications, keeping only the newest one for each community/user pair
  const query = `
    DELETE FROM notifications 
    WHERE id NOT IN (
      SELECT MAX(id) 
      FROM notifications 
      WHERE user_id = ? AND type = 'join_request'
      GROUP BY related_id, created_by
    )
    AND user_id = ? AND type = 'join_request'
  `;

  db.run(query, [userId, userId], function(err) {
    if (err) {
      console.error('Error cleaning duplicates:', err);
      return res.status(500).json({ error: 'Error cleaning duplicates' });
    }
    res.json({ success: true, deleted: this.changes });
  });
});

module.exports = router;
