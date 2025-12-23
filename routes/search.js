const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const { getDb } = require('../config/database');

// Search users
router.get('/users', authMiddleware, (req, res) => {
  const db = getDb();
  const { q } = req.query;
  const currentUserId = req.user.userId;

  if (!q || q.trim().length === 0) {
    return res.json({ success: true, users: [] });
  }

  const query = `
    SELECT 
      u.id, u.username, u.fullname, u.profile_picture, u.bio, u.email,
      (SELECT COUNT(*) FROM followers WHERE follower_id = ? AND following_id = u.id) as is_following
    FROM users u
    LEFT JOIN blocked_users b1 ON (b1.blocker_id = ? AND b1.blocked_id = u.id)
    LEFT JOIN blocked_users b2 ON (b2.blocker_id = u.id AND b2.blocked_id = ?)
    WHERE (u.username LIKE ? OR u.fullname LIKE ? OR u.email LIKE ? OR u.bio LIKE ?)
      AND u.id != ?
      AND b1.id IS NULL
      AND b2.id IS NULL
    ORDER BY 
      CASE 
        WHEN u.username LIKE ? THEN 1
        WHEN u.fullname LIKE ? THEN 2
        WHEN u.email LIKE ? THEN 3
        ELSE 4
      END,
      u.username ASC
    LIMIT 20
  `;

  const searchTerm = `%${q}%`;
  const exactTerm = `${q}%`;

  db.all(query, [currentUserId, currentUserId, currentUserId, searchTerm, searchTerm, searchTerm, searchTerm, currentUserId, exactTerm, exactTerm, exactTerm], (err, users) => {
    if (err) {
      return res.status(500).json({ error: 'Error searching users' });
    }
    res.json({ success: true, users });
  });
});

// Search communities
router.get('/communities', authMiddleware, (req, res) => {
  const db = getDb();
  const { q } = req.query;
  const userId = req.user.userId;

  if (!q || q.trim().length === 0) {
    return res.json({ success: true, communities: [] });
  }

  const query = `
    SELECT 
      c.*,
      u.username as admin_username,
      (SELECT COUNT(*) FROM community_members WHERE community_id = c.id) as member_count,
      (SELECT COUNT(*) FROM community_members WHERE community_id = c.id AND user_id = ?) as is_member
    FROM communities c
    JOIN users u ON c.admin_id = u.id
    WHERE c.is_public = 1
      AND (c.name LIKE ? OR c.team_name LIKE ? OR c.description LIKE ?)
    ORDER BY member_count DESC
    LIMIT 20
  `;

  const searchTerm = `%${q}%`;

  db.all(query, [userId, searchTerm, searchTerm, searchTerm], (err, communities) => {
    if (err) {
      return res.status(500).json({ error: 'Error searching communities' });
    }
    res.json({ success: true, communities });
  });
});

module.exports = router;
