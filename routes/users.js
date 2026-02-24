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
      u.favorite_teams, u.profile_picture, u.created_at, u.is_private,
      (SELECT COUNT(*) FROM posts WHERE user_id = u.id AND is_archived = 0) as post_count,
      (SELECT COUNT(*) FROM followers WHERE following_id = u.id) as followers_count,
      (SELECT COUNT(*) FROM followers WHERE follower_id = u.id) as following_count,
      (SELECT COUNT(*) FROM followers WHERE follower_id = ? AND following_id = u.id) as is_following,
      (SELECT COUNT(*) FROM blocked_users WHERE blocker_id = ? AND blocked_id = u.id) as is_blocked,
      (SELECT COUNT(*) FROM follow_requests WHERE requester_id = ? AND target_id = u.id AND status = 'pending') as has_requested_follow
    FROM users u
    WHERE u.id = ?
  `;

  db.get(query, [currentUserId, currentUserId, currentUserId, userId], (err, user) => {
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
  const currentUserId = req.user.userId;

  // Check if user is private and current user is not a follower
  if (parseInt(userId) !== currentUserId) {
    db.get('SELECT is_private FROM users WHERE id = ?', [userId], (err, targetUser) => {
      if (err || !targetUser) {
        return res.status(404).json({ error: 'User not found' });
      }

      if (targetUser.is_private) {
        // Check if current user follows the private user
        db.get('SELECT id FROM followers WHERE follower_id = ? AND following_id = ?', [currentUserId, userId], (err, follow) => {
          if (!follow) {
            // Not a follower — only return public posts (is_public_post = 1)
            return fetchUserPosts(db, userId, currentUserId, res, true);
          }
          // Is a follower — return all posts
          return fetchUserPosts(db, userId, currentUserId, res, false);
        });
        return;
      }
      // Public account — return all posts
      return fetchUserPosts(db, userId, currentUserId, res, false);
    });
  } else {
    // Own profile — return all posts
    return fetchUserPosts(db, userId, currentUserId, res, false);
  }
});

function fetchUserPosts(db, userId, currentUserId, res, onlyPublicPosts) {
  let query = `
    SELECT p.*, u.username, u.profile_picture,
           (SELECT COUNT(*) FROM post_likes WHERE post_id = p.id) as likes_count,
           (SELECT COUNT(*) FROM post_comments WHERE post_id = p.id) as comments_count,
           (SELECT COUNT(*) FROM post_likes WHERE post_id = p.id AND user_id = ?) as user_has_liked,
           (SELECT COUNT(*) FROM saved_posts WHERE post_id = p.id AND user_id = ?) as is_saved,
           (SELECT COUNT(*) FROM post_interactions WHERE post_id = p.id AND type = 'interested') as interested_count
    FROM posts p
    JOIN users u ON p.user_id = u.id
    WHERE p.user_id = ? AND p.is_archived = 0 AND p.is_story = 0
  `;

  if (onlyPublicPosts) {
    query += ` AND p.is_public_post = 1`;
  }

  query += ` ORDER BY p.created_at DESC LIMIT 50`;

  db.all(query, [currentUserId, currentUserId, userId], (err, posts) => {
    if (err) {
      return res.status(500).json({ error: 'Error fetching posts' });
    }

    // Process posts with poll data (matching home feed behavior)
    const processedPosts = [];
    let pending = posts.length;

    if (posts.length === 0) {
      return res.json({ success: true, posts: [] });
    }

    posts.forEach(post => {
      db.get('SELECT * FROM polls WHERE post_id = ?', [post.id], (err, poll) => {
        if (poll) {
          db.get('SELECT option_index FROM poll_votes WHERE poll_id = ? AND user_id = ?', [poll.id, currentUserId], (err2, userVote) => {
            const parsedOptions = JSON.parse(poll.options);
            const processedPost = {
              ...post,
              images: post.images ? JSON.parse(post.images) : [],
              files: post.files ? JSON.parse(post.files) : [],
              hashtags: post.hashtags ? JSON.parse(post.hashtags) : [],
              custom_button: post.custom_button ? JSON.parse(post.custom_button) : null,
              user_has_liked: post.user_has_liked > 0,
              is_saved: post.is_saved > 0,
              poll: {
                ...poll,
                options: parsedOptions,
                votes: JSON.parse(poll.votes),
                user_voted: userVote ? parsedOptions[userVote.option_index] : null
              }
            };
            processedPosts.push(processedPost);
            pending--;
            if (pending === 0) {
              processedPosts.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
              res.json({ success: true, posts: processedPosts });
            }
          });
          return;
        }
        const processedPost = {
          ...post,
          images: post.images ? JSON.parse(post.images) : [],
          files: post.files ? JSON.parse(post.files) : [],
          hashtags: post.hashtags ? JSON.parse(post.hashtags) : [],
          custom_button: post.custom_button ? JSON.parse(post.custom_button) : null,
          user_has_liked: post.user_has_liked > 0,
          is_saved: post.is_saved > 0,
          poll: null
        };
        processedPosts.push(processedPost);
        pending--;
        if (pending === 0) {
          processedPosts.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
          res.json({ success: true, posts: processedPosts });
        }
      });
    });
  });
}

// Get user's saved posts
router.get('/:userId/saved', authMiddleware, (req, res) => {
  const db = getDb();
  const userId = req.user.userId;

  // Only allow users to view their own saved posts
  if (parseInt(req.params.userId) !== userId) {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  const query = `
    SELECT p.*, u.username, u.profile_picture, sp.created_at as saved_at,
           (SELECT COUNT(*) FROM post_likes WHERE post_id = p.id) as likes_count,
           (SELECT COUNT(*) FROM post_comments WHERE post_id = p.id) as comments_count,
           (SELECT COUNT(*) FROM post_likes WHERE post_id = p.id AND user_id = ?) as user_has_liked,
           1 as is_saved
    FROM saved_posts sp
    JOIN posts p ON sp.post_id = p.id
    JOIN users u ON p.user_id = u.id
    WHERE sp.user_id = ?
    ORDER BY sp.created_at DESC
  `;

  db.all(query, [userId, userId], (err, posts) => {
    if (err) {
      return res.status(500).json({ error: 'Error fetching saved posts' });
    }

    // Process posts with poll data (matching home feed behavior)
    const processedPosts = [];
    let pending = posts.length;

    if (posts.length === 0) {
      return res.json({ success: true, posts: [] });
    }

    posts.forEach(post => {
      db.get('SELECT * FROM polls WHERE post_id = ?', [post.id], (err, poll) => {
        if (poll) {
          db.get('SELECT option_index FROM poll_votes WHERE poll_id = ? AND user_id = ?', [poll.id, userId], (err2, userVote) => {
            const parsedOptions = JSON.parse(poll.options);
            const processedPost = {
              ...post,
              images: post.images ? JSON.parse(post.images) : [],
              files: post.files ? JSON.parse(post.files) : [],
              hashtags: post.hashtags ? JSON.parse(post.hashtags) : [],
              custom_button: post.custom_button ? JSON.parse(post.custom_button) : null,
              user_has_liked: post.user_has_liked > 0,
              is_saved: true,
              poll: {
                ...poll,
                options: parsedOptions,
                votes: JSON.parse(poll.votes),
                user_voted: userVote ? parsedOptions[userVote.option_index] : null
              }
            };
            processedPosts.push(processedPost);
            pending--;
            if (pending === 0) {
              processedPosts.sort((a, b) => new Date(b.saved_at) - new Date(a.saved_at));
              res.json({ success: true, posts: processedPosts });
            }
          });
          return;
        }
        const processedPost = {
          ...post,
          images: post.images ? JSON.parse(post.images) : [],
          files: post.files ? JSON.parse(post.files) : [],
          hashtags: post.hashtags ? JSON.parse(post.hashtags) : [],
          custom_button: post.custom_button ? JSON.parse(post.custom_button) : null,
          user_has_liked: post.user_has_liked > 0,
          is_saved: true,
          poll: null
        };
        processedPosts.push(processedPost);
        pending--;
        if (pending === 0) {
          processedPosts.sort((a, b) => new Date(b.saved_at) - new Date(a.saved_at));
          res.json({ success: true, posts: processedPosts });
        }
      });
    });
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

// Follow user (with private account support)
router.post('/:userId/follow', authMiddleware, (req, res) => {
  const db = getDb();
  const followerId = req.user.userId;
  const followingId = parseInt(req.params.userId);

  if (followerId === followingId) {
    return res.status(400).json({ error: 'Cannot follow yourself' });
  }

  // Check if target user is private
  db.get('SELECT is_private FROM users WHERE id = ?', [followingId], (err, targetUser) => {
    if (err || !targetUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (targetUser.is_private) {
      // Private account: check if already requested or already following
      db.get('SELECT id FROM followers WHERE follower_id = ? AND following_id = ?', [followerId, followingId], (err, existingFollow) => {
        if (existingFollow) {
          return res.json({ success: true, status: 'following' }); // already following
        }
        db.get('SELECT id FROM follow_requests WHERE requester_id = ? AND target_id = ? AND status = ?', [followerId, followingId, 'pending'], (err, existingReq) => {
          if (existingReq) {
            return res.json({ success: true, status: 'requested' }); // already requested
          }
          db.run(
            'INSERT OR IGNORE INTO follow_requests (requester_id, target_id, status) VALUES (?, ?, ?)',
            [followerId, followingId, 'pending'],
            function(err) {
              if (err) {
                return res.status(500).json({ error: 'Error sending follow request' });
              }

              // Delete any old follow_request notifications to prevent duplicates, then create new
              db.run(
                'DELETE FROM notifications WHERE user_id = ? AND type = ? AND related_id = ?',
                [followingId, 'follow_request', followerId],
                function() {
                  db.run(
                    'INSERT INTO notifications (user_id, type, content, related_id) VALUES (?, ?, ?, ?)',
                    [followingId, 'follow_request', 'requested to follow you', followerId]
                  );
                }
              );

              // Emit real-time notification
              const io = req.app.get('io');
              if (io) {
                io.to(`user-${followingId}`).emit('notification:received', {
                  type: 'follow_request',
                  content: 'requested to follow you',
                  related_id: followerId
                });
              }

              res.json({ success: true, status: 'requested' });
            }
          );
        });
      });
    } else {
      // Public account: check if already following
      db.get('SELECT id FROM followers WHERE follower_id = ? AND following_id = ?', [followerId, followingId], (err, existingFollow) => {
        if (existingFollow) {
          return res.json({ success: true, status: 'following' }); // already following, no crash
        }
        db.run(
          'INSERT OR IGNORE INTO followers (follower_id, following_id) VALUES (?, ?)',
          [followerId, followingId],
          function(err) {
            if (err) {
              return res.status(500).json({ error: 'Error following user' });
            }

            // Delete any old follow notifications to prevent duplicates, then create new
            db.run(
              'DELETE FROM notifications WHERE user_id = ? AND type = ? AND related_id = ?',
              [followingId, 'follow', followerId],
              function() {
                db.run(
                  'INSERT INTO notifications (user_id, type, content, related_id) VALUES (?, ?, ?, ?)',
                  [followingId, 'follow', 'started following you', followerId]
                );
              }
            );

            res.json({ success: true, status: 'following' });
          }
        );
      });
    }
  });
});

// Unfollow user (also cancels pending follow requests)
router.delete('/:userId/follow', authMiddleware, (req, res) => {
  const db = getDb();
  const followerId = req.user.userId;
  const followingId = parseInt(req.params.userId);

  // Delete from followers
  db.run(
    'DELETE FROM followers WHERE follower_id = ? AND following_id = ?',
    [followerId, followingId],
    function(err) {
      if (err) {
        return res.status(500).json({ error: 'Error unfollowing user' });
      }

      // Also delete any pending follow request
      db.run(
        'DELETE FROM follow_requests WHERE requester_id = ? AND target_id = ?',
        [followerId, followingId]
      );

      // Delete the follow notification sent to the other user
      db.run(
        'DELETE FROM notifications WHERE user_id = ? AND type = ? AND related_id = ?',
        [followingId, 'follow', followerId]
      );

      // Delete any follow_request notification too
      db.run(
        'DELETE FROM notifications WHERE user_id = ? AND type = ? AND related_id = ?',
        [followingId, 'follow_request', followerId]
      );

      res.json({ success: true });
    }
  );
});

// ===== FOLLOW REQUEST ENDPOINTS =====

// Get pending follow requests (for current user)
router.get('/follow-requests/pending', authMiddleware, (req, res) => {
  const db = getDb();
  const userId = req.user.userId;

  db.all(`
    SELECT fr.id, fr.requester_id, fr.created_at, 
           u.username, u.profile_picture, u.bio
    FROM follow_requests fr
    JOIN users u ON fr.requester_id = u.id
    WHERE fr.target_id = ? AND fr.status = 'pending'
    ORDER BY fr.created_at DESC
  `, [userId], (err, requests) => {
    if (err) {
      return res.status(500).json({ error: 'Error fetching follow requests' });
    }
    res.json({ success: true, requests: requests || [] });
  });
});

// Accept follow request
router.post('/follow-requests/:requestId/accept', authMiddleware, (req, res) => {
  const db = getDb();
  const userId = req.user.userId;
  const requestId = parseInt(req.params.requestId);

  db.get('SELECT * FROM follow_requests WHERE id = ? AND target_id = ? AND status = ?', [requestId, userId, 'pending'], (err, request) => {
    if (err || !request) {
      return res.status(404).json({ error: 'Follow request not found' });
    }

    // Accept: add to followers and update request status
    db.run('INSERT OR IGNORE INTO followers (follower_id, following_id) VALUES (?, ?)', [request.requester_id, request.target_id], function(err) {
      if (err) {
        return res.status(500).json({ error: 'Error accepting follow request' });
      }

      db.run('UPDATE follow_requests SET status = ? WHERE id = ?', ['accepted', requestId]);

      // Notify the requester that their request was accepted
      db.run(
        'INSERT INTO notifications (user_id, type, content, related_id) VALUES (?, ?, ?, ?)',
        [request.requester_id, 'follow_accepted', 'accepted your follow request', userId]
      );

      const io = req.app.get('io');
      if (io) {
        io.to(`user-${request.requester_id}`).emit('notification:received', {
          type: 'follow_accepted',
          content: 'accepted your follow request',
          related_id: userId
        });
      }

      res.json({ success: true });
    });
  });
});

// Decline follow request
router.post('/follow-requests/:requestId/decline', authMiddleware, (req, res) => {
  const db = getDb();
  const userId = req.user.userId;
  const requestId = parseInt(req.params.requestId);

  db.run('UPDATE follow_requests SET status = ? WHERE id = ? AND target_id = ?', ['declined', requestId, userId], function(err) {
    if (err) {
      return res.status(500).json({ error: 'Error declining follow request' });
    }
    res.json({ success: true });
  });
});

// Get follow request count
router.get('/follow-requests/count', authMiddleware, (req, res) => {
  const db = getDb();
  const userId = req.user.userId;

  db.get('SELECT COUNT(*) as count FROM follow_requests WHERE target_id = ? AND status = ?', [userId, 'pending'], (err, result) => {
    if (err) {
      return res.status(500).json({ error: 'Error fetching count' });
    }
    res.json({ success: true, count: result ? result.count : 0 });
  });
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

// Toggle private account
router.put('/privacy', authMiddleware, (req, res) => {
  const db = getDb();
  const userId = req.user.userId;
  const { is_private } = req.body;

  db.run(
    'UPDATE users SET is_private = ? WHERE id = ?',
    [is_private ? 1 : 0, userId],
    function(err) {
      if (err) {
        return res.status(500).json({ error: 'Error updating privacy setting' });
      }

      // If switching from private to public, auto-accept all pending follow requests
      if (!is_private) {
        db.all('SELECT requester_id FROM follow_requests WHERE target_id = ? AND status = ?', [userId, 'pending'], (err, requests) => {
          if (requests && requests.length > 0) {
            requests.forEach(req => {
              db.run('INSERT OR IGNORE INTO followers (follower_id, following_id) VALUES (?, ?)', [req.requester_id, userId]);
            });
            db.run('UPDATE follow_requests SET status = ? WHERE target_id = ? AND status = ?', ['accepted', userId, 'pending']);
          }
        });
      }

      res.json({ success: true, is_private: is_private ? 1 : 0 });
    }
  );
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
