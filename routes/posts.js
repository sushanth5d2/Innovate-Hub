const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const upload = require('../middleware/upload');
const { getDb } = require('../config/database');

// Get all posts (home feed)
router.get('/', authMiddleware, (req, res) => {
  const db = getDb();
  const userId = req.user.userId;

  // Get posts excluding stories that have expired
  const query = `
    SELECT p.*, u.username, u.profile_picture,
           (SELECT COUNT(*) FROM post_likes WHERE post_id = p.id) as likes_count,
           (SELECT COUNT(*) FROM post_comments WHERE post_id = p.id) as comments_count,
           (SELECT COUNT(*) FROM post_likes WHERE post_id = p.id AND user_id = ?) as user_has_liked,
           (SELECT COUNT(*) FROM saved_posts WHERE post_id = p.id AND user_id = ?) as is_saved
    FROM posts p
    JOIN users u ON p.user_id = u.id
    LEFT JOIN blocked_users b1 ON (b1.blocker_id = ? AND b1.blocked_id = p.user_id)
    LEFT JOIN blocked_users b2 ON (b2.blocker_id = p.user_id AND b2.blocked_id = ?)
    WHERE p.is_archived = 0
      AND p.is_story = 0
      AND (p.scheduled_at IS NULL OR p.scheduled_at <= CURRENT_TIMESTAMP)
      AND b1.id IS NULL
      AND b2.id IS NULL
    ORDER BY p.created_at DESC
    LIMIT 50
  `;

  db.all(query, [userId, userId, userId, userId], (err, posts) => {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).json({ error: 'Error fetching posts' });
    }

    // Parse JSON fields and fetch polls
    const processedPosts = [];
    let pending = posts.length;

    if (posts.length === 0) {
      return res.json({ success: true, posts: [] });
    }

    posts.forEach(post => {
      // Get poll data if exists
      db.get('SELECT * FROM polls WHERE post_id = ?', [post.id], (err, poll) => {
        const processedPost = {
          ...post,
          images: post.images ? JSON.parse(post.images) : [],
          files: post.files ? JSON.parse(post.files) : [],
          hashtags: post.hashtags ? JSON.parse(post.hashtags) : [],
          user_has_liked: post.user_has_liked > 0,
          is_saved: post.is_saved > 0,
          poll: poll ? {
            ...poll,
            options: JSON.parse(poll.options),
            votes: JSON.parse(poll.votes)
          } : null
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
});

// Get stories only
router.get('/stories', authMiddleware, (req, res) => {
  const db = getDb();
  const userId = req.user.userId;

  const query = `
    SELECT p.*, u.username, u.profile_picture,
      EXISTS(SELECT 1 FROM story_views sv WHERE sv.story_id = p.id AND sv.user_id = ?) as viewed_by_current_user
    FROM posts p
    JOIN users u ON p.user_id = u.id
    LEFT JOIN blocked_users b1 ON (b1.blocker_id = ? AND b1.blocked_id = p.user_id)
    LEFT JOIN blocked_users b2 ON (b2.blocker_id = p.user_id AND b2.blocked_id = ?)
    WHERE p.is_story = 1
      AND p.expires_at > CURRENT_TIMESTAMP
      AND b1.id IS NULL
      AND b2.id IS NULL
    ORDER BY p.created_at DESC
  `;

  db.all(query, [userId, userId, userId], (err, stories) => {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).json({ error: 'Error fetching stories' });
    }

    stories = stories.map(story => ({
      ...story,
      images: story.images ? JSON.parse(story.images) : [],
      files: story.files ? JSON.parse(story.files) : [],
      video_url: story.video_url || null,
      viewed_by_current_user: Boolean(story.viewed_by_current_user)
    }));

    res.json({ success: true, stories });
  });
});

// Mark story as viewed
router.post('/stories/:storyId/view', authMiddleware, (req, res) => {
  const db = getDb();
  const userId = req.user.userId;
  const { storyId } = req.params;

  const query = `INSERT OR IGNORE INTO story_views (story_id, user_id) VALUES (?, ?)`;

  db.run(query, [storyId, userId], function(err) {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).json({ error: 'Error marking story as viewed' });
    }

    res.json({ success: true });
  });
});

// Create post
router.post('/', authMiddleware, upload.fields([
  { name: 'images', maxCount: 10 },
  { name: 'files', maxCount: 5 },
  { name: 'video', maxCount: 1 }
]), (req, res) => {
  const db = getDb();
  const userId = req.user.userId;
  const { 
    content, 
    is_story, 
    scheduled_at, 
    video_url,
    hashtags,
    enable_contact,
    enable_interested,
    poll_question,
    poll_options,
    poll_expiry
  } = req.body;

  let images = [];
  let files = [];
  let videoPath = video_url || null;

  if (req.files) {
    if (req.files.images) {
      images = req.files.images.map(file => `/uploads/images/${file.filename}`);
    }
    if (req.files.files) {
      files = req.files.files.map(file => ({
        name: file.originalname,
        path: `/uploads/files/${file.filename}`,
        size: file.size
      }));
    }
    if (req.files.video && req.files.video[0]) {
      videoPath = `/uploads/images/${req.files.video[0].filename}`;
    }
  }

  // Calculate expiry for stories (24 hours)
  let expires_at = null;
  if (is_story === 'true' || is_story === true) {
    const expiryDate = new Date();
    expiryDate.setHours(expiryDate.getHours() + 24);
    expires_at = expiryDate.toISOString();
  }

  const query = `
    INSERT INTO posts (user_id, content, images, files, video_url, is_story, scheduled_at, expires_at, hashtags, enable_contact, enable_interested)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  db.run(
    query,
    [
      userId,
      content || null,
      JSON.stringify(images),
      JSON.stringify(files),
      videoPath,
      is_story === 'true' || is_story === true ? 1 : 0,
      scheduled_at || null,
      expires_at,
      hashtags || null,
      enable_contact === '1' || enable_contact === true ? 1 : 0,
      enable_interested === '1' || enable_interested === true ? 1 : 0
    ],
    function(err) {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).json({ error: 'Error creating post' });
      }

      const postId = this.lastID;

      // Process hashtags
      if (hashtags) {
        try {
          const tags = JSON.parse(hashtags);
          tags.forEach(tag => {
            db.run(`
              INSERT INTO hashtags (tag, usage_count) 
              VALUES (?, 1) 
              ON CONFLICT(tag) DO UPDATE SET usage_count = usage_count + 1
            `, [tag.toLowerCase()]);
          });
        } catch (e) {
          console.error('Error processing hashtags:', e);
        }
      }

      // Create poll if provided
      if (poll_question && poll_options) {
        try {
          const options = JSON.parse(poll_options);
          db.run(`
            INSERT INTO polls (post_id, question, options, votes, expires_at)
            VALUES (?, ?, ?, ?, ?)
          `, [
            postId,
            poll_question,
            JSON.stringify(options),
            JSON.stringify(Array(options.length).fill(0)),
            poll_expiry || null
          ]);
        } catch (e) {
          console.error('Error creating poll:', e);
        }
      }

      res.json({
        success: true,
        post: {
          id: this.lastID,
          content,
          images,
          files,
          video_url: videoPath,
          is_story: is_story ? 1 : 0,
          created_at: new Date().toISOString()
        }
      });
    }
  );
});

// Create poll
router.post('/:postId/poll', authMiddleware, (req, res) => {
  const db = getDb();
  const { postId } = req.params;
  const { question, options, expires_at } = req.body;
  const userId = req.user.userId;

  // Verify post ownership
  db.get('SELECT * FROM posts WHERE id = ? AND user_id = ?', [postId, userId], (err, post) => {
    if (err || !post) {
      return res.status(404).json({ error: 'Post not found or unauthorized' });
    }

    const query = `
      INSERT INTO polls (post_id, question, options, votes, expires_at)
      VALUES (?, ?, ?, ?, ?)
    `;

    const votesObj = {};
    options.forEach(opt => votesObj[opt] = 0);

    db.run(
      query,
      [postId, question, JSON.stringify(options), JSON.stringify(votesObj), expires_at || null],
      function(err) {
        if (err) {
          return res.status(500).json({ error: 'Error creating poll' });
        }

        res.json({
          success: true,
          poll: {
            id: this.lastID,
            question,
            options: JSON.parse(JSON.stringify(options)),
            votes: votesObj
          }
        });
      }
    );
  });
});

// Vote on poll
router.post('/:postId/poll/:pollId/vote', authMiddleware, (req, res) => {
  const db = getDb();
  const { pollId } = req.params;
  const { option } = req.body;

  db.get('SELECT * FROM polls WHERE id = ?', [pollId], (err, poll) => {
    if (err || !poll) {
      return res.status(404).json({ error: 'Poll not found' });
    }

    const votes = JSON.parse(poll.votes);
    if (votes[option] !== undefined) {
      votes[option]++;

      db.run('UPDATE polls SET votes = ? WHERE id = ?', [JSON.stringify(votes), pollId], (err) => {
        if (err) {
          return res.status(500).json({ error: 'Error voting' });
        }

        res.json({ success: true, votes });
      });
    } else {
      res.status(400).json({ error: 'Invalid option' });
    }
  });
});

// Like/Unlike post
router.post('/:postId/like', authMiddleware, (req, res) => {
  const db = getDb();
  const userId = req.user.userId;
  const { postId } = req.params;

  // Check if already liked
  db.get('SELECT * FROM post_likes WHERE post_id = ? AND user_id = ?', [postId, userId], (err, like) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }

    if (like) {
      // Unlike
      db.run('DELETE FROM post_likes WHERE post_id = ? AND user_id = ?', [postId, userId], (err) => {
        if (err) {
          return res.status(500).json({ error: 'Error unliking post' });
        }

        // Update post likes count
        db.run('UPDATE posts SET likes_count = likes_count - 1 WHERE id = ?', [postId]);
        res.json({ success: true, liked: false });
      });
    } else {
      // Like
      db.run('INSERT INTO post_likes (post_id, user_id) VALUES (?, ?)', [postId, userId], (err) => {
        if (err) {
          return res.status(500).json({ error: 'Error liking post' });
        }

        // Update post likes count
        db.run('UPDATE posts SET likes_count = likes_count + 1 WHERE id = ?', [postId]);

        // Create notification for post owner
        db.get('SELECT user_id FROM posts WHERE id = ?', [postId], (err, post) => {
          if (post && post.user_id !== userId) {
            db.run(
              'INSERT INTO notifications (user_id, type, content, related_id) VALUES (?, ?, ?, ?)',
              [post.user_id, 'like', 'liked your post', postId]
            );

            // Emit socket notification
            const io = req.app.get('io');
            if (io) {
              io.to(`user_${post.user_id}`).emit('notification:receive', {
                type: 'like',
                content: 'liked your post',
                post_id: postId
              });
            }
          }
        });

        res.json({ success: true, liked: true });
      });
    }
  });
});

// Post action (Contact Me / I'm Interested)
router.post('/:postId/action', authMiddleware, (req, res) => {
  const db = getDb();
  const userId = req.user.userId;
  const { postId } = req.params;
  const { action_type } = req.body;

  if (!action_type || !['contact', 'interested'].includes(action_type)) {
    return res.status(400).json({ error: 'Invalid action type' });
  }

  const query = `INSERT OR REPLACE INTO post_actions (post_id, user_id, action_type) VALUES (?, ?, ?)`;

  db.run(query, [postId, userId, action_type], function(err) {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).json({ error: 'Error recording action' });
    }

    // Create notification for post owner
    db.get('SELECT user_id FROM posts WHERE id = ?', [postId], (err, post) => {
      if (post && post.user_id !== userId) {
        const notificationContent = action_type === 'contact' 
          ? 'wants to contact you' 
          : 'is interested in your post';
        
        db.run(
          'INSERT INTO notifications (user_id, type, content, related_id) VALUES (?, ?, ?, ?)',
          [post.user_id, action_type, notificationContent, postId]
        );

        const io = req.app.get('io');
        if (io) {
          io.to(`user_${post.user_id}`).emit('notification:receive', {
            type: action_type,
            content: notificationContent,
            post_id: postId
          });
        }
      }
    });

    res.json({ success: true });
  });
});

// Add comment
router.post('/:postId/comments', authMiddleware, (req, res) => {
  const db = getDb();
  const userId = req.user.userId;
  const { postId } = req.params;
  const { content } = req.body;

  if (!content || !content.trim()) {
    return res.status(400).json({ error: 'Comment content required' });
  }

  db.run(
    'INSERT INTO post_comments (post_id, user_id, content) VALUES (?, ?, ?)',
    [postId, userId, content.trim()],
    function(err) {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).json({ error: 'Error adding comment' });
      }

      // Update post comments count
      db.run('UPDATE posts SET comments_count = comments_count + 1 WHERE id = ?', [postId]);

      // Create notification for post owner
      db.get('SELECT user_id FROM posts WHERE id = ?', [postId], (err, post) => {
        if (post && post.user_id !== userId) {
          db.run(
            'INSERT INTO notifications (user_id, type, content, related_id) VALUES (?, ?, ?, ?)',
            [post.user_id, 'comment', 'commented on your post', postId]
          );

          // Emit socket notification
          const io = req.app.get('io');
          if (io) {
            io.to(`user_${post.user_id}`).emit('notification:receive', {
              type: 'comment',
              content: 'commented on your post',
              post_id: postId
            });
          }
        }
      });

      res.json({ success: true, commentId: this.lastID });
    }
  );
});

// Get comments for a post
router.get('/:postId/comments', authMiddleware, (req, res) => {
  const db = getDb();
  const { postId } = req.params;

  const query = `
    SELECT c.*, u.username, u.profile_picture
    FROM post_comments c
    JOIN users u ON c.user_id = u.id
    WHERE c.post_id = ?
    ORDER BY c.created_at DESC
  `;

  db.all(query, [postId], (err, comments) => {
    if (err) {
      return res.status(500).json({ error: 'Error fetching comments' });
    }
    res.json({ success: true, comments });
  });
});

// Post interaction (interested, contact, share)
router.post('/:postId/interact', authMiddleware, (req, res) => {
  const db = getDb();
  const userId = req.user.userId;
  const { postId } = req.params;
  const { type } = req.body; // 'interested', 'contact', 'share'

  const query = `
    INSERT INTO post_interactions (post_id, user_id, type)
    VALUES (?, ?, ?)
  `;

  db.run(query, [postId, userId, type], function(err) {
    if (err) {
      return res.status(500).json({ error: 'Error recording interaction' });
    }

    // Create notification for post owner
    db.get('SELECT user_id FROM posts WHERE id = ?', [postId], (err, post) => {
      if (post && post.user_id !== userId) {
        const notificationContent = type === 'interested' 
          ? 'is interested in your post'
          : type === 'contact'
          ? 'wants to contact you about your post'
          : 'shared your post';

        db.run(
          'INSERT INTO notifications (user_id, type, content, related_id) VALUES (?, ?, ?, ?)',
          [post.user_id, 'post_interaction', notificationContent, postId]
        );
      }
    });

    res.json({ success: true });
  });
});

// Save post
router.post('/:postId/save', authMiddleware, (req, res) => {
  const db = getDb();
  const userId = req.user.userId;
  const { postId } = req.params;

  db.run(
    'INSERT OR IGNORE INTO saved_posts (user_id, post_id) VALUES (?, ?)',
    [userId, postId],
    function(err) {
      if (err) {
        return res.status(500).json({ error: 'Error saving post' });
      }
      res.json({ success: true });
    }
  );
});

// Unsave post
router.delete('/:postId/save', authMiddleware, (req, res) => {
  const db = getDb();
  const userId = req.user.userId;
  const { postId } = req.params;

  db.run(
    'DELETE FROM saved_posts WHERE user_id = ? AND post_id = ?',
    [userId, postId],
    function(err) {
      if (err) {
        return res.status(500).json({ error: 'Error unsaving post' });
      }
      res.json({ success: true });
    }
  );
});

// Create gentle reminder
router.post('/:postId/reminder', authMiddleware, (req, res) => {
  const db = getDb();
  const userId = req.user.userId;
  const { postId } = req.params;
  const { reminder_date, message } = req.body;

  if (!reminder_date) {
    return res.status(400).json({ error: 'Reminder date is required' });
  }

  db.run(
    'INSERT INTO gentle_reminders (user_id, post_id, reminder_date, message) VALUES (?, ?, ?, ?)',
    [userId, postId, reminder_date, message || ''],
    function(err) {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).json({ error: 'Error creating reminder' });
      }

      // Also create an event for the reminder
      db.run(
        'INSERT INTO events (creator_id, title, description, event_date, location) VALUES (?, ?, ?, ?, ?)',
        [userId, 'Reminder', message || 'Gentle reminder from post', reminder_date, 'From Post'],
        (err) => {
          if (err) console.error('Error creating event for reminder:', err);
        }
      );

      res.json({ success: true, reminderId: this.lastID });
    }
  );
});

// Create instant meeting
router.post('/:postId/meeting', authMiddleware, (req, res) => {
  const db = getDb();
  const userId = req.user.userId;
  const { postId } = req.params;
  const { platform, meeting_date, title, description } = req.body;

  if (!platform || !meeting_date || !title) {
    return res.status(400).json({ error: 'Platform, date, and title are required' });
  }

  // Generate meeting URL placeholder based on platform
  const meetingUrls = {
    'google-meet': `https://meet.google.com/new`,
    'zoom': `https://zoom.us/start/webmeeting`,
    'teams': `https://teams.microsoft.com/meet`,
    'discord': `https://discord.gg/`
  };

  const meeting_url = meetingUrls[platform] || '';

  db.run(
    'INSERT INTO instant_meetings (post_id, creator_id, platform, meeting_url, meeting_date, title, description) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [postId, userId, platform, meeting_url, meeting_date, title, description || ''],
    function(err) {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).json({ error: 'Error creating meeting' });
      }

      // Create an event for the meeting
      db.run(
        'INSERT INTO events (creator_id, title, description, event_date, location, notes) VALUES (?, ?, ?, ?, ?, ?)',
        [userId, title, description, meeting_date, `${platform} meeting`, meeting_url],
        (err) => {
          if (err) console.error('Error creating event for meeting:', err);
        }
      );

      res.json({ 
        success: true, 
        meetingId: this.lastID,
        meeting_url: meeting_url
      });
    }
  );
});

// Update post (owner only)
router.put('/:postId', authMiddleware, upload.fields([
  { name: 'images', maxCount: 10 },
  { name: 'files', maxCount: 5 }
]), (req, res) => {
  const db = getDb();
  const userId = req.user.userId;
  const { postId } = req.params;
  const { content } = req.body;

  db.get('SELECT * FROM posts WHERE id = ? AND user_id = ?', [postId, userId], (err, post) => {
    if (err || !post) {
      return res.status(404).json({ error: 'Post not found or unauthorized' });
    }

    let images = post.images ? JSON.parse(post.images) : [];
    let files = post.files ? JSON.parse(post.files) : [];

    if (req.files) {
      if (req.files.images) {
        images = [...images, ...req.files.images.map(file => `/uploads/images/${file.filename}`)];
      }
      if (req.files.files) {
        const newFiles = req.files.files.map(file => ({
          name: file.originalname,
          path: `/uploads/files/${file.filename}`,
          size: file.size
        }));
        files = [...files, ...newFiles];
      }
    }

    db.run(
      'UPDATE posts SET content = ?, images = ?, files = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [content, JSON.stringify(images), JSON.stringify(files), postId],
      (err) => {
        if (err) {
          return res.status(500).json({ error: 'Error updating post' });
        }
        res.json({ success: true });
      }
    );
  });
});

// Archive post
router.put('/:postId/archive', authMiddleware, (req, res) => {
  const db = getDb();
  const userId = req.user.userId;
  const { postId } = req.params;

  db.run(
    'UPDATE posts SET is_archived = 1 WHERE id = ? AND user_id = ?',
    [postId, userId],
    function(err) {
      if (err) {
        return res.status(500).json({ error: 'Error archiving post' });
      }
      if (this.changes === 0) {
        return res.status(404).json({ error: 'Post not found or unauthorized' });
      }
      res.json({ success: true });
    }
  );
});

// Delete post
router.delete('/:postId', authMiddleware, (req, res) => {
  const db = getDb();
  const userId = req.user.userId;
  const { postId } = req.params;

  db.run(
    'DELETE FROM posts WHERE id = ? AND user_id = ?',
    [postId, userId],
    function(err) {
      if (err) {
        return res.status(500).json({ error: 'Error deleting post' });
      }
      if (this.changes === 0) {
        return res.status(404).json({ error: 'Post not found or unauthorized' });
      }
      res.json({ success: true });
    }
  );
});

module.exports = router;
