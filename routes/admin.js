const express = require('express');
const router = express.Router();
const adminMiddleware = require('../middleware/adminAuth');
const { getDb } = require('../config/database');
const upload = require('../middleware/upload');

// Dashboard stats
router.get('/dashboard', adminMiddleware, (req, res) => {
  const db = getDb();
  const queries = {
    totalUsers: 'SELECT COUNT(*) as count FROM users WHERE is_admin IS NOT TRUE',
    activeToday: "SELECT COUNT(*) as count FROM users WHERE last_seen >= CURRENT_DATE AND is_admin IS NOT TRUE",
    totalPosts: 'SELECT COUNT(*) as count FROM posts WHERE is_archived = 0 AND is_admin_post IS NOT TRUE',
    pendingReports: "SELECT COUNT(*) as count FROM post_reports WHERE status = 'pending'",
    bannedUsers: 'SELECT COUNT(*) as count FROM users WHERE is_banned IS TRUE AND is_admin IS NOT TRUE',
    deactivatedUsers: 'SELECT COUNT(*) as count FROM users WHERE is_deactivated IS TRUE AND is_admin IS NOT TRUE',
    totalCommunities: 'SELECT COUNT(*) as count FROM communities',
    totalEvents: 'SELECT COUNT(*) as count FROM events'
  };

  const stats = {};
  let completed = 0;
  const keys = Object.keys(queries);
  
  keys.forEach(key => {
    db.get(queries[key], [], (err, row) => {
      stats[key] = err ? 0 : (row ? row.count : 0);
      completed++;
      if (completed === keys.length) {
        // Recent signups (last 7 days)
        db.get("SELECT COUNT(*) as count FROM users WHERE created_at >= CURRENT_DATE - INTERVAL '7 days' AND is_admin IS NOT TRUE", [], (err2, row2) => {
          stats.recentSignups = err2 ? 0 : (row2 ? row2.count : 0);
          res.json({ success: true, stats });
        });
      }
    });
  });
});

// List all users
router.get('/users', adminMiddleware, (req, res) => {
  const db = getDb();
  const { search, filter, page = 1, limit = 50 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  let where = '1=1';
  const params = [];

  if (search) {
    where += ' AND (u.username ILIKE $' + (params.length + 1) + ' OR u.email ILIKE $' + (params.length + 2) + ')';
    params.push(`%${search}%`, `%${search}%`);
  }

  if (filter === 'banned') where += ' AND u.is_banned = TRUE';
  else if (filter === 'deactivated') where += ' AND u.is_deactivated = TRUE';
  else if (filter === 'admin') where += ' AND u.is_admin = TRUE';
  else if (filter === 'active') where += ' AND u.is_banned IS NOT TRUE AND u.is_deactivated IS NOT TRUE AND u.is_admin IS NOT TRUE';
  else where += ' AND u.is_admin IS NOT TRUE';

  const countParam = params.length;
  params.push(parseInt(limit), offset);

  const query = `
    SELECT u.id, u.username, u.email, u.fullname, u.profile_picture, u.is_admin, 
           u.is_banned, u.banned_until, u.ban_reason, u.is_deactivated, u.is_private,
           u.created_at, u.last_seen, u.is_online,
           (SELECT COUNT(*) FROM posts WHERE user_id = u.id AND is_archived = 0) as post_count,
           (SELECT COUNT(*) FROM followers WHERE following_id = u.id) as follower_count
    FROM users u
    WHERE ${where}
    ORDER BY u.created_at DESC
    LIMIT $${countParam + 1} OFFSET $${countParam + 2}
  `;

  db.all(query, params, (err, users) => {
    if (err) return res.status(500).json({ error: 'Error fetching users' });
    
    // Get total count
    db.get(`SELECT COUNT(*) as count FROM users u WHERE ${where}`, params.slice(0, countParam), (err2, countRow) => {
      res.json({ 
        success: true, 
        users: users || [], 
        total: countRow ? countRow.count : 0,
        page: parseInt(page),
        limit: parseInt(limit)
      });
    });
  });
});

// Ban user
router.post('/users/:userId/ban', adminMiddleware, (req, res) => {
  const db = getDb();
  const { userId } = req.params;
  const adminId = req.user.userId;
  const { reason, duration_days } = req.body;

  if (parseInt(userId) === adminId) {
    return res.status(400).json({ error: 'Cannot ban yourself' });
  }

  // Check if target is also admin
  db.get('SELECT is_admin FROM users WHERE id = ?', [userId], (err, target) => {
    if (err || !target) return res.status(404).json({ error: 'User not found' });
    if (target.is_admin) return res.status(400).json({ error: 'Cannot ban another admin' });

    let bannedUntil = null;
    if (duration_days && duration_days > 0) {
      bannedUntil = new Date(Date.now() + duration_days * 24 * 60 * 60 * 1000).toISOString();
    }

    db.run(
      'UPDATE users SET is_banned = 1, banned_until = ?, ban_reason = ? WHERE id = ?',
      [bannedUntil, reason || 'Policy violation', userId],
      function(err) {
        if (err) return res.status(500).json({ error: 'Failed to ban user' });
        
        // Log admin action
        db.run('INSERT INTO admin_actions (admin_id, action_type, target_user_id, details) VALUES (?, ?, ?, ?)',
          [adminId, bannedUntil ? 'temp_ban' : 'permanent_ban', userId, 
           JSON.stringify({ reason, duration_days, banned_until: bannedUntil })]);

        res.json({ 
          success: true, 
          message: bannedUntil ? `User temporarily banned until ${new Date(bannedUntil).toLocaleDateString()}` : 'User permanently banned'
        });
      }
    );
  });
});

// Unban user
router.delete('/users/:userId/ban', adminMiddleware, (req, res) => {
  const db = getDb();
  const { userId } = req.params;
  const adminId = req.user.userId;

  db.run(
    'UPDATE users SET is_banned = 0, banned_until = NULL, ban_reason = NULL WHERE id = ?',
    [userId],
    function(err) {
      if (err) return res.status(500).json({ error: 'Failed to unban user' });
      
      db.run('INSERT INTO admin_actions (admin_id, action_type, target_user_id, details) VALUES (?, ?, ?, ?)',
        [adminId, 'unban', userId, '{}']);

      res.json({ success: true, message: 'User unbanned' });
    }
  );
});

// Delete any post (admin moderation)
router.delete('/posts/:postId', adminMiddleware, (req, res) => {
  const db = getDb();
  const { postId } = req.params;
  const adminId = req.user.userId;
  const { reason } = req.body || {};

  // Get post info before deleting
  db.get('SELECT user_id, content FROM posts WHERE id = ?', [postId], (err, post) => {
    if (err || !post) return res.status(404).json({ error: 'Post not found' });

    db.run('DELETE FROM posts WHERE id = ?', [postId], function(err) {
      if (err) return res.status(500).json({ error: 'Failed to delete post' });

      // Log action
      db.run('INSERT INTO admin_actions (admin_id, action_type, target_user_id, target_post_id, details) VALUES (?, ?, ?, ?, ?)',
        [adminId, 'delete_post', post.user_id, postId, JSON.stringify({ reason: reason || 'Guideline violation' })]);

      // Notify the post owner
      db.run(`INSERT INTO notifications (user_id, type, content, from_user_id, created_at)
              VALUES (?, 'admin', ?, ?, CURRENT_TIMESTAMP)`,
        [post.user_id, 'Your post was removed by an admin for: ' + (reason || 'community guideline violation'), adminId]);

      // Also dismiss any reports for this post
      db.run("UPDATE post_reports SET status = 'resolved', reviewed_by = ? WHERE post_id = ? AND status = 'pending'",
        [adminId, postId]);

      res.json({ success: true, message: 'Post deleted' });
    });
  });
});

// Get reported posts
router.get('/reports', adminMiddleware, (req, res) => {
  const db = getDb();
  const { status = 'pending' } = req.query;

  const query = `
    SELECT pr.id as report_id, pr.reason, pr.details, pr.status, pr.created_at as reported_at,
           pr.post_id, pr.reporter_id,
           reporter.username as reporter_username, reporter.profile_picture as reporter_avatar,
           p.content as post_content, p.images as post_images, p.user_id as post_owner_id,
           p.created_at as post_created_at,
           owner.username as post_owner_username, owner.profile_picture as post_owner_avatar
    FROM post_reports pr
    JOIN users reporter ON reporter.id = pr.reporter_id
    JOIN posts p ON p.id = pr.post_id
    JOIN users owner ON owner.id = p.user_id
    WHERE pr.status = $1
    ORDER BY pr.created_at DESC
    LIMIT 100
  `;

  db.all(query, [status], (err, reports) => {
    if (err) return res.status(500).json({ error: 'Error fetching reports' });
    res.json({ success: true, reports: reports || [] });
  });
});

// Review/dismiss a report
router.put('/reports/:reportId', adminMiddleware, (req, res) => {
  const db = getDb();
  const { reportId } = req.params;
  const { action } = req.body; // 'dismiss' or 'resolved'
  const adminId = req.user.userId;

  const newStatus = action === 'dismiss' ? 'dismissed' : 'resolved';

  db.run('UPDATE post_reports SET status = ?, reviewed_by = ? WHERE id = ?',
    [newStatus, adminId, reportId], function(err) {
      if (err) return res.status(500).json({ error: 'Failed to update report' });
      res.json({ success: true, message: `Report ${newStatus}` });
    });
});

// Create admin post (announcement / promoted post)
router.post('/announcements', adminMiddleware, (req, res, next) => {
  upload.fields([
    { name: 'images', maxCount: 10 },
    { name: 'video', maxCount: 1 }
  ])(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || 'Upload error' });
    next();
  });
}, (req, res) => {
  const db = getDb();
  const adminId = req.user.userId;
  const { content, frequency = 'once', feed_position = '3', is_creator_series } = req.body;

  if (!content || !content.trim()) {
    return res.status(400).json({ error: 'Content is required' });
  }

  const validFreqs = ['once', 'daily', 'weekly'];
  if (!validFreqs.includes(frequency)) {
    return res.status(400).json({ error: 'Frequency must be once, daily, or weekly' });
  }

  const position = Math.max(1, Math.min(50, parseInt(feed_position) || 3));

  let images = [];
  let videoPath = null;
  if (req.files) {
    if (req.files.images) {
      images = req.files.images.map(f => `/uploads/images/${f.filename}`);
    }
    if (req.files.video && req.files.video[0]) {
      videoPath = `/uploads/images/${req.files.video[0].filename}`;
    }
  }

  const hashtags = content.match(/#[\w]+/g);

  db.run(
    `INSERT INTO posts (user_id, content, images, video_url, is_admin_post, admin_frequency, admin_feed_position, is_creator_series, hashtags, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [
      adminId,
      content.trim(),
      JSON.stringify(images),
      videoPath,
      1,
      frequency,
      position,
      is_creator_series === 'true' || is_creator_series === '1' ? 1 : 0,
      hashtags ? JSON.stringify(hashtags.map(h => h.substring(1))) : null
    ],
    function(err) {
      if (err) {
        console.error('Admin post error:', err);
        return res.status(500).json({ error: 'Failed to create post' });
      }

      db.run('INSERT INTO admin_actions (admin_id, action_type, target_post_id, details) VALUES (?, ?, ?, ?)',
        [adminId, 'create_announcement', this.lastID, JSON.stringify({ frequency, feed_position: position })]);

      res.json({ success: true, post_id: this.lastID, message: 'Admin post created' });
    }
  );
});

// List admin posts
router.get('/admin-posts', adminMiddleware, (req, res) => {
  const db = getDb();
  db.all(
    `SELECT p.*, u.username, u.profile_picture 
     FROM posts p JOIN users u ON p.user_id = u.id
     WHERE p.is_admin_post IS TRUE
     ORDER BY p.created_at DESC LIMIT 50`,
    [],
    (err, posts) => {
      if (err) return res.status(500).json({ error: 'Failed to fetch admin posts' });
      res.json({ success: true, posts: posts || [] });
    }
  );
});

// Get admin action log
router.get('/actions', adminMiddleware, (req, res) => {
  const db = getDb();
  const query = `
    SELECT a.*, u.username as admin_username, 
           tu.username as target_username
    FROM admin_actions a
    JOIN users u ON u.id = a.admin_id
    LEFT JOIN users tu ON tu.id = a.target_user_id
    ORDER BY a.created_at DESC
    LIMIT 100
  `;
  db.all(query, [], (err, actions) => {
    if (err) return res.status(500).json({ error: 'Error fetching actions' });
    res.json({ success: true, actions: actions || [] });
  });
});

// Check if current user is admin (used by frontend)
router.get('/check', adminMiddleware, (req, res) => {
  res.json({ success: true, isAdmin: true });
});

module.exports = router;
