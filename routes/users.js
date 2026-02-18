const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const upload = require('../middleware/upload');
const { getDb } = require('../config/database');

// Get user profile
router.get('/:userId', authMiddleware, (req, res) => {
  const db = getDb();
  const { userId } = req.params;
  const currentUserId = req.user.userId;

  const query = `
    SELECT 
      u.id, u.username, u.email, u.bio, u.skills, u.interests, u.fullname,
      u.favorite_teams, u.profile_picture, u.created_at,
      (SELECT COUNT(*) FROM posts WHERE user_id = u.id AND is_archived = 0) as post_count,
      (SELECT COUNT(*) FROM followers WHERE following_id = u.id) as followers_count,
      (SELECT COUNT(*) FROM followers WHERE follower_id = u.id) as following_count,
      (SELECT COUNT(*) FROM followers WHERE follower_id = ? AND following_id = u.id) as is_following,
      (SELECT COUNT(*) FROM blocked_users WHERE blocker_id = ? AND blocked_id = u.id) as is_blocked
    FROM users u
    WHERE u.id = ?
  `;

  db.get(query, [currentUserId, currentUserId, userId], (err, user) => {
    if (err || !user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Parse JSON fields
    user.skills = user.skills ? JSON.parse(user.skills) : [];
    user.interests = user.interests ? JSON.parse(user.interests) : [];
    user.favorite_teams = user.favorite_teams ? JSON.parse(user.favorite_teams) : [];

    // Don't send email if not own profile
    if (currentUserId !== parseInt(userId)) {
      delete user.email;
    }

    res.json({ success: true, user });
  });
});

// Get user's posts
router.get('/:userId/posts', authMiddleware, (req, res) => {
  const db = getDb();
  const { userId } = req.params;

  const query = `
    SELECT p.*, u.username, u.profile_picture,
           (SELECT COUNT(*) FROM post_interactions WHERE post_id = p.id AND type = 'interested') as interested_count
    FROM posts p
    JOIN users u ON p.user_id = u.id
    WHERE p.user_id = ? AND p.is_archived = 0 AND p.is_story = 0
    ORDER BY p.created_at DESC
    LIMIT 50
  `;

  db.all(query, [userId], (err, posts) => {
    if (err) {
      return res.status(500).json({ error: 'Error fetching posts' });
    }

    posts = posts.map(post => ({
      ...post,
      images: post.images ? JSON.parse(post.images) : [],
      files: post.files ? JSON.parse(post.files) : []
    }));

    res.json({ success: true, posts });
  });
});

// Get user's saved posts
router.get('/:userId/saved', authMiddleware, (req, res) => {
  const db = getDb();
  const userId = req.user.userId;

  // Only allow users to view their own saved posts
  if (parseInt(req.params.userId) !== userId) {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  const query = `
    SELECT p.*, u.username, u.profile_picture, sp.created_at as saved_at
    FROM saved_posts sp
    JOIN posts p ON sp.post_id = p.id
    JOIN users u ON p.user_id = u.id
    WHERE sp.user_id = ?
    ORDER BY sp.created_at DESC
  `;

  db.all(query, [userId], (err, posts) => {
    if (err) {
      return res.status(500).json({ error: 'Error fetching saved posts' });
    }

    posts = posts.map(post => ({
      ...post,
      images: post.images ? JSON.parse(post.images) : [],
      files: post.files ? JSON.parse(post.files) : []
    }));

    res.json({ success: true, posts });
  });
});

// Get followers
router.get('/:userId/followers', authMiddleware, (req, res) => {
  const db = getDb();
  const { userId } = req.params;

  const query = `
    SELECT u.id, u.username, u.profile_picture, u.bio, f.created_at as followed_at
    FROM followers f
    JOIN users u ON f.follower_id = u.id
    WHERE f.following_id = ?
    ORDER BY f.created_at DESC
  `;

  db.all(query, [userId], (err, followers) => {
    if (err) {
      return res.status(500).json({ error: 'Error fetching followers' });
    }
    res.json({ success: true, followers });
  });
});

// Get following
router.get('/:userId/following', authMiddleware, (req, res) => {
  const db = getDb();
  const { userId } = req.params;

  const query = `
    SELECT u.id, u.username, u.profile_picture, u.bio, f.created_at as followed_at
    FROM followers f
    JOIN users u ON f.following_id = u.id
    WHERE f.follower_id = ?
    ORDER BY f.created_at DESC
  `;

  db.all(query, [userId], (err, following) => {
    if (err) {
      return res.status(500).json({ error: 'Error fetching following' });
    }
    res.json({ success: true, following });
  });
});

// Update profile picture only
router.post('/profile-picture', authMiddleware, upload.single('profile_picture'), (req, res) => {
  const db = getDb();
  const userId = req.user.userId;

  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  const profile_picture = `/uploads/profiles/${req.file.filename}`;

  db.run(
    'UPDATE users SET profile_picture = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    [profile_picture, userId],
    function(err) {
      if (err) {
        return res.status(500).json({ error: 'Error updating profile picture' });
      }
      res.json({ success: true, profile_picture });
    }
  );
});

// Update profile
router.put('/', authMiddleware, upload.single('profile_picture'), (req, res) => {
  const db = getDb();
  const userId = req.user.userId;
  const { bio, skills, interests, favorite_teams, fullname, username } = req.body;

  let profile_picture = null;
  if (req.file) {
    profile_picture = `/uploads/profiles/${req.file.filename}`;
  }

  // Parse arrays if they're strings
  const skillsArray = typeof skills === 'string' ? JSON.parse(skills) : skills;
  const interestsArray = typeof interests === 'string' ? JSON.parse(interests) : interests;
  const teamsArray = typeof favorite_teams === 'string' ? JSON.parse(favorite_teams) : favorite_teams;

  let query = `UPDATE users SET bio = ?, skills = ?, interests = ?, favorite_teams = ?, fullname = ?, updated_at = CURRENT_TIMESTAMP`;
  let params = [bio, JSON.stringify(skillsArray), JSON.stringify(interestsArray), JSON.stringify(teamsArray), fullname || ''];

  if (profile_picture) {
    query += `, profile_picture = ?`;
    params.push(profile_picture);
  }

  if (username && username.trim()) {
    query += `, username = ?`;
    params.push(username.trim());
  }

  query += ` WHERE id = ?`;
  params.push(userId);

  db.run(query, params, function(err) {
    if (err) {
      return res.status(500).json({ error: 'Error updating profile' });
    }
    res.json({ success: true, profile_picture });
  });
});

// Follow user
router.post('/:userId/follow', authMiddleware, (req, res) => {
  const db = getDb();
  const followerId = req.user.userId;
  const followingId = parseInt(req.params.userId);

  if (followerId === followingId) {
    return res.status(400).json({ error: 'Cannot follow yourself' });
  }

  db.run(
    'INSERT OR IGNORE INTO followers (follower_id, following_id) VALUES (?, ?)',
    [followerId, followingId],
    function(err) {
      if (err) {
        return res.status(500).json({ error: 'Error following user' });
      }

      // Create notification
      db.run(
        'INSERT INTO notifications (user_id, type, content, related_id) VALUES (?, ?, ?, ?)',
        [followingId, 'follow', 'started following you', followerId]
      );

      res.json({ success: true });
    }
  );
});

// Unfollow user
router.delete('/:userId/follow', authMiddleware, (req, res) => {
  const db = getDb();
  const followerId = req.user.userId;
  const followingId = parseInt(req.params.userId);

  db.run(
    'DELETE FROM followers WHERE follower_id = ? AND following_id = ?',
    [followerId, followingId],
    function(err) {
      if (err) {
        return res.status(500).json({ error: 'Error unfollowing user' });
      }
      res.json({ success: true });
    }
  );
});

// Block user
router.post('/:userId/block', authMiddleware, (req, res) => {
  const db = getDb();
  const blockerId = req.user.userId;
  const blockedId = parseInt(req.params.userId);

  if (blockerId === blockedId) {
    return res.status(400).json({ error: 'Cannot block yourself' });
  }

  db.run(
    'INSERT OR IGNORE INTO blocked_users (blocker_id, blocked_id) VALUES (?, ?)',
    [blockerId, blockedId],
    function(err) {
      if (err) {
        return res.status(500).json({ error: 'Error blocking user' });
      }

      // Remove any existing follows
      db.run('DELETE FROM followers WHERE (follower_id = ? AND following_id = ?) OR (follower_id = ? AND following_id = ?)',
        [blockerId, blockedId, blockedId, blockerId]);

      res.json({ success: true });
    }
  );
});

// Unblock user
router.delete('/:userId/block', authMiddleware, (req, res) => {
  const db = getDb();
  const blockerId = req.user.userId;
  const blockedId = parseInt(req.params.userId);

  db.run(
    'DELETE FROM blocked_users WHERE blocker_id = ? AND blocked_id = ?',
    [blockerId, blockedId],
    function(err) {
      if (err) {
        return res.status(500).json({ error: 'Error unblocking user' });
      }
      res.json({ success: true });
    }
  );
});

// Get blocked users
router.get('/blocked/list', authMiddleware, (req, res) => {
  const db = getDb();
  const userId = req.user.userId;

  const query = `
    SELECT u.id, u.username, u.profile_picture, b.created_at as blocked_at
    FROM blocked_users b
    JOIN users u ON b.blocked_id = u.id
    WHERE b.blocker_id = ?
    ORDER BY b.created_at DESC
  `;

  db.all(query, [userId], (err, blocked) => {
    if (err) {
      return res.status(500).json({ error: 'Error fetching blocked users' });
    }
    res.json({ success: true, blocked });
  });
});

// Toggle online status
router.put('/online-status', authMiddleware, (req, res) => {
  const db = getDb();
  const userId = req.user.userId;
  const { is_online } = req.body;

  db.run(
    'UPDATE users SET is_online = ? WHERE id = ?',
    [is_online ? 1 : 0, userId],
    function(err) {
      if (err) {
        return res.status(500).json({ error: 'Error updating online status' });
      }
      res.json({ success: true, is_online: is_online ? 1 : 0 });
    }
  );
});

// Remove a follower (remove someone who follows you)
router.delete('/:userId/remove-follower', authMiddleware, (req, res) => {
  const db = getDb();
  const currentUserId = req.user.userId;
  const followerToRemove = parseInt(req.params.userId);

  db.run(
    'DELETE FROM followers WHERE follower_id = ? AND following_id = ?',
    [followerToRemove, currentUserId],
    function(err) {
      if (err) {
        return res.status(500).json({ error: 'Error removing follower' });
      }
      res.json({ success: true });
    }
  );
});

// Mute a user
router.post('/:userId/mute', authMiddleware, (req, res) => {
  const db = getDb();
  const currentUserId = req.user.userId;
  const mutedUserId = parseInt(req.params.userId);

  // Create muted_users table if not exists, then insert
  db.run(`CREATE TABLE IF NOT EXISTS muted_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    muted_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, muted_id)
  )`, (err) => {
    if (err) return res.status(500).json({ error: 'Error creating mute table' });

    db.run(
      'INSERT OR IGNORE INTO muted_users (user_id, muted_id) VALUES (?, ?)',
      [currentUserId, mutedUserId],
      function(err) {
        if (err) return res.status(500).json({ error: 'Error muting user' });
        res.json({ success: true });
      }
    );
  });
});

// Unmute a user
router.delete('/:userId/mute', authMiddleware, (req, res) => {
  const db = getDb();
  const currentUserId = req.user.userId;
  const mutedUserId = parseInt(req.params.userId);

  db.run(
    'DELETE FROM muted_users WHERE user_id = ? AND muted_id = ?',
    [currentUserId, mutedUserId],
    function(err) {
      if (err) return res.status(500).json({ error: 'Error unmuting user' });
      res.json({ success: true });
    }
  );
});

// Search users (for @mention and share)
router.get('/search/query', authMiddleware, (req, res) => {
  const db = getDb();
  const { q } = req.query;
  const userId = req.user.userId;

  if (!q || q.length < 1) {
    return res.json({ success: true, users: [] });
  }

  const query = `
    SELECT id, username, profile_picture, bio
    FROM users
    WHERE username LIKE ? AND id != ?
    ORDER BY username ASC
    LIMIT 10
  `;

  db.all(query, [`%${q}%`, userId], (err, users) => {
    if (err) return res.status(500).json({ error: 'Error searching users' });
    res.json({ success: true, users: users || [] });
  });
});

// Get frequently messaged users (for share post)
router.get('/frequent/messaged', authMiddleware, (req, res) => {
  const db = getDb();
  const userId = req.user.userId;

  const query = `
    SELECT u.id, u.username, u.profile_picture, u.bio, COUNT(*) as msg_count
    FROM messages m
    JOIN users u ON (
      CASE
        WHEN m.sender_id = ? THEN m.receiver_id = u.id
        WHEN m.receiver_id = ? THEN m.sender_id = u.id
      END
    )
    WHERE (m.sender_id = ? OR m.receiver_id = ?) AND u.id != ?
    GROUP BY u.id
    ORDER BY msg_count DESC
    LIMIT 10
  `;

  db.all(query, [userId, userId, userId, userId, userId], (err, users) => {
    if (err) return res.status(500).json({ error: 'Error fetching users' });
    res.json({ success: true, users: users || [] });
  });
});

// Get followers with follow-back status
router.get('/:userId/followers-detailed', authMiddleware, (req, res) => {
  const db = getDb();
  const { userId } = req.params;
  const currentUserId = req.user.userId;

  const query = `
    SELECT u.id, u.username, u.profile_picture, u.bio,
           f.created_at as followed_at,
           (SELECT COUNT(*) FROM followers WHERE follower_id = ? AND following_id = u.id) as is_following_back
    FROM followers f
    JOIN users u ON f.follower_id = u.id
    WHERE f.following_id = ?
    ORDER BY f.created_at DESC
  `;

  db.all(query, [currentUserId, userId], (err, followers) => {
    if (err) return res.status(500).json({ error: 'Error fetching followers' });
    res.json({ success: true, followers: followers || [] });
  });
});

// Get following with detailed info
router.get('/:userId/following-detailed', authMiddleware, (req, res) => {
  const db = getDb();
  const { userId } = req.params;

  const query = `
    SELECT u.id, u.username, u.profile_picture, u.bio,
           f.created_at as followed_at
    FROM followers f
    JOIN users u ON f.following_id = u.id
    WHERE f.follower_id = ?
    ORDER BY f.created_at DESC
  `;

  db.all(query, [userId], (err, following) => {
    if (err) return res.status(500).json({ error: 'Error fetching following' });
    res.json({ success: true, following: following || [] });
  });
});

module.exports = router;
