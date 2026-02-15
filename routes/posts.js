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
        if (poll) {
          // Check if current user has voted on this poll
          db.get('SELECT option_index FROM poll_votes WHERE poll_id = ? AND user_id = ?', [poll.id, userId], (err2, userVote) => {
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

// Get trending hashtags
router.get('/trending-hashtags', authMiddleware, (req, res) => {
  const db = getDb();
  db.all(
    'SELECT tag, usage_count FROM hashtags ORDER BY usage_count DESC LIMIT 20',
    [],
    (err, hashtags) => {
      if (err) {
        console.error('Error fetching trending hashtags:', err);
        return res.json({ success: true, hashtags: [] });
      }
      res.json({ success: true, hashtags: hashtags || [] });
    }
  );
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
    poll_expiry,
    custom_button
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
    INSERT INTO posts (user_id, content, images, files, video_url, is_story, scheduled_at, expires_at, hashtags, enable_contact, enable_interested, custom_button)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      enable_interested === '1' || enable_interested === true ? 1 : 0,
      custom_button || null
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
          // Store votes as {optionText: 0} object for reliable key lookup
          const votesObj = {};
          options.forEach(opt => { votesObj[opt] = 0; });
          db.run(`
            INSERT INTO polls (post_id, question, options, votes, expires_at)
            VALUES (?, ?, ?, ?, ?)
          `, [
            postId,
            poll_question,
            JSON.stringify(options),
            JSON.stringify(votesObj),
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

// Vote on poll (single vote per user, allows switching)
router.post('/:postId/poll/:pollId/vote', authMiddleware, (req, res) => {
  const db = getDb();
  const userId = req.user.userId;
  const { pollId } = req.params;
  const { option } = req.body;

  if (!option) {
    return res.status(400).json({ error: 'Option is required' });
  }

  db.get('SELECT * FROM polls WHERE id = ?', [pollId], (err, poll) => {
    if (err || !poll) {
      return res.status(404).json({ error: 'Poll not found' });
    }

    let votes = JSON.parse(poll.votes);
    const options = JSON.parse(poll.options);

    // Migrate legacy array format
    if (Array.isArray(votes)) {
      const votesObj = {};
      options.forEach((opt, idx) => { votesObj[opt] = votes[idx] || 0; });
      votes = votesObj;
    }

    if (votes[option] === undefined) {
      return res.status(400).json({ error: 'Invalid option' });
    }

    const optionIndex = options.indexOf(option);

    // Check if user already voted
    db.get('SELECT * FROM poll_votes WHERE poll_id = ? AND user_id = ?', [pollId, userId], (err, existingVote) => {
      if (err) return res.status(500).json({ error: 'Database error' });

      if (existingVote) {
        // User already voted — switch vote
        const prevOption = options[existingVote.option_index];
        if (prevOption === option) {
          return res.json({ success: true, votes, user_voted: option, message: 'Already voted for this option' });
        }
        // Decrement old, increment new
        if (votes[prevOption] !== undefined && votes[prevOption] > 0) votes[prevOption]--;
        votes[option]++;

        db.run('UPDATE poll_votes SET option_index = ? WHERE poll_id = ? AND user_id = ?', [optionIndex, pollId, userId], (err) => {
          if (err) return res.status(500).json({ error: 'Error switching vote' });
          db.run('UPDATE polls SET votes = ? WHERE id = ?', [JSON.stringify(votes), pollId], (err) => {
            if (err) return res.status(500).json({ error: 'Error updating votes' });
            res.json({ success: true, votes, user_voted: option });
          });
        });
      } else {
        // New vote
        votes[option]++;
        db.run('INSERT INTO poll_votes (poll_id, user_id, option_index) VALUES (?, ?, ?)', [pollId, userId, optionIndex], (err) => {
          if (err) return res.status(500).json({ error: 'Error recording vote' });
          db.run('UPDATE polls SET votes = ? WHERE id = ?', [JSON.stringify(votes), pollId], (err) => {
            if (err) return res.status(500).json({ error: 'Error updating votes' });
            res.json({ success: true, votes, user_voted: option });
          });
        });
      }
    });
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
        
        // Get updated count
        db.get('SELECT likes_count FROM posts WHERE id = ?', [postId], (err, post) => {
          res.json({ success: true, liked: false, likes_count: post ? post.likes_count : 0 });
        });
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
        db.get('SELECT user_id, likes_count FROM posts WHERE id = ?', [postId], (err, post) => {
          if (post && post.user_id !== userId) {
            db.run(
              'INSERT INTO notifications (user_id, type, content, related_id, created_by) VALUES (?, ?, ?, ?, ?)',
              [post.user_id, 'like', 'liked your post', postId, userId]
            );

            // Emit socket notification
            const io = req.app.get('io');
            if (io) {
              io.to(`user_${post.user_id}`).emit('notification:receive', {
                type: 'like',
                content: 'liked your post',
                post_id: postId,
                created_by: userId
              });
            }
          }
          
          res.json({ success: true, liked: true, likes_count: post ? post.likes_count : 1 });
        });
      });
    }
  });
});

// Get a single post by ID
router.get('/:postId', authMiddleware, (req, res) => {
  const db = getDb();
  const { postId } = req.params;
  const userId = req.user.userId;

  const query = `
    SELECT p.*, u.username, u.profile_picture,
      (SELECT COUNT(*) FROM post_likes WHERE post_id = p.id) as likes_count,
      (SELECT COUNT(*) FROM post_comments WHERE post_id = p.id) as comments_count,
      (SELECT COUNT(*) FROM post_likes WHERE post_id = p.id AND user_id = ?) as user_has_liked,
      (SELECT COUNT(*) FROM saved_posts WHERE post_id = p.id AND user_id = ?) as is_saved
    FROM posts p
    JOIN users u ON p.user_id = u.id
    WHERE p.id = ?
  `;

  db.get(query, [userId, userId, postId], (err, post) => {
    if (err) {
      console.error('GET /posts/:postId error:', err.message);
      return res.status(500).json({ error: 'Database error', detail: err.message });
    }
    if (!post) return res.status(404).json({ error: 'Post not found' });
    
    // Parse JSON fields
    try { post.images = post.images ? JSON.parse(post.images) : []; } catch(e) { post.images = []; }
    try { post.files = post.files ? JSON.parse(post.files) : []; } catch(e) { post.files = []; }
    try { post.hashtags = post.hashtags ? JSON.parse(post.hashtags) : []; } catch(e) { post.hashtags = []; }
    try { post.custom_button = post.custom_button ? JSON.parse(post.custom_button) : null; } catch(e) { post.custom_button = null; }
    
    // Get poll data if exists
    db.get('SELECT * FROM polls WHERE post_id = ?', [postId], (err2, poll) => {
      if (poll) {
        try {
          post.poll = {
            id: poll.id,
            question: poll.question,
            options: JSON.parse(poll.options),
            votes: JSON.parse(poll.votes),
            expires_at: poll.expires_at
          };
        } catch(e) { post.poll = null; }
      } else {
        post.poll = null;
      }
      res.json({ post });
    });
  });
});

// Get users who liked a post
router.get('/:postId/likes', authMiddleware, (req, res) => {
  const db = getDb();
  const { postId } = req.params;

  const query = `
    SELECT u.id as user_id, u.username, u.profile_picture, u.bio, pl.created_at as liked_at
    FROM post_likes pl
    JOIN users u ON pl.user_id = u.id
    WHERE pl.post_id = ?
    ORDER BY pl.created_at DESC
  `;

  db.all(query, [postId], (err, likes) => {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).json({ error: 'Error fetching likes' });
    }

    res.json({ success: true, likes: likes || [] });
  });
});

// Post action (Contact Me / I'm Interested)
router.post('/:postId/action', authMiddleware, (req, res) => {
  const db = getDb();
  const userId = req.user.userId;
  const { postId } = req.params;
  const { action_type } = req.body;

  if (!action_type || !['contact', 'interested', 'custom_dm', 'custom_hire'].includes(action_type)) {
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
          'INSERT INTO notifications (user_id, type, content, related_id, created_by) VALUES (?, ?, ?, ?, ?)',
          [post.user_id, action_type, notificationContent, postId, userId]
        );

        const io = req.app.get('io');
        if (io) {
          io.to(`user_${post.user_id}`).emit('notification:receive', {
            type: action_type,
            content: notificationContent,
            post_id: postId,
            created_by: userId
          });
        }
      }
    });

    res.json({ success: true });
  });
});

// Handle custom button submissions (DM, Hire Me form)
router.post('/:postId/custom-button-action', authMiddleware, (req, res) => {
  const db = getDb();
  const userId = req.user.userId;
  const { postId } = req.params;
  const { action, message, hire_data } = req.body;

  // Get the post and its owner
  db.get('SELECT p.*, u.username FROM posts p JOIN users u ON p.user_id = u.id WHERE p.id = ?', [postId], (err, post) => {
    if (err || !post) {
      return res.status(404).json({ error: 'Post not found' });
    }

    if (post.user_id === userId) {
      return res.status(400).json({ error: 'Cannot perform this action on your own post' });
    }

    // Get the acting user's info
    db.get('SELECT username FROM users WHERE id = ?', [userId], (err, actingUser) => {
      if (err || !actingUser) {
        return res.status(500).json({ error: 'User not found' });
      }

      let dmContent = '';

      if (action === 'dm') {
        dmContent = message || `Hi! I'm reaching out about your post.`;
      } else if (action === 'hire_me') {
        if (!hire_data) {
          return res.status(400).json({ error: 'Hire form data required' });
        }
        // Format hire details neatly
        dmContent = `📋 **Hire Me Application**\n`;
        dmContent += `━━━━━━━━━━━━━━━━━━━━\n`;
        if (hire_data.name) dmContent += `👤 Name: ${hire_data.name}\n`;
        if (hire_data.email) dmContent += `📧 Email: ${hire_data.email}\n`;
        if (hire_data.contact) dmContent += `📞 Contact: ${hire_data.contact}\n`;
        if (hire_data.resume_link) dmContent += `🔗 Resume: ${hire_data.resume_link}\n`;
        if (hire_data.custom_fields && Object.keys(hire_data.custom_fields).length > 0) {
          dmContent += `━━━━━━━━━━━━━━━━━━━━\n`;
          dmContent += `📝 Additional Info:\n`;
          for (const [key, value] of Object.entries(hire_data.custom_fields)) {
            if (value) dmContent += `  • ${key}: ${value}\n`;
          }
        }
        dmContent += `━━━━━━━━━━━━━━━━━━━━\n`;
        dmContent += `Sent via post by @${actingUser.username}`;
      } else {
        return res.status(400).json({ error: 'Invalid action' });
      }

      // Send DM to post owner
      db.run(
        'INSERT INTO messages (sender_id, receiver_id, content, attachments) VALUES (?, ?, ?, ?)',
        [userId, post.user_id, dmContent, '[]'],
        function(err) {
          if (err) {
            console.error('Error sending DM:', err);
            return res.status(500).json({ error: 'Failed to send message' });
          }

          // Create notification
          const notifContent = action === 'hire_me' 
            ? 'submitted a hire me application on your post'
            : 'sent you a message about your post';
          
          db.run(
            'INSERT INTO notifications (user_id, type, content, related_id, created_by) VALUES (?, ?, ?, ?, ?)',
            [post.user_id, 'custom_button', notifContent, postId, userId]
          );

          // Real-time notification
          const io = req.app.get('io');
          if (io) {
            io.to(`user_${post.user_id}`).emit('notification:receive', {
              type: 'custom_button',
              content: notifContent,
              post_id: postId,
              created_by: userId
            });
            io.to(`user_${post.user_id}`).emit('message:receive', {
              id: this.lastID,
              sender_id: userId,
              sender_username: actingUser.username,
              content: dmContent,
              created_at: new Date().toISOString()
            });
          }

          res.json({ success: true, message: 'Message sent successfully' });
        }
      );
    });
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
            'INSERT INTO notifications (user_id, type, content, related_id, created_by) VALUES (?, ?, ?, ?, ?)',
            [post.user_id, 'comment', 'commented on your post', postId, userId]
          );

          // Emit socket notification
          const io = req.app.get('io');
          if (io) {
            io.to(`user_${post.user_id}`).emit('notification:receive', {
              type: 'comment',
              content: 'commented on your post',
              post_id: postId,
              created_by: userId
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
  const { content, poll_question, poll_options, poll_expiry, scheduled_at, enable_contact, enable_interested, hashtags, custom_button } = req.body;

  db.get('SELECT * FROM posts WHERE id = ? AND user_id = ?', [postId, userId], (err, post) => {
    if (err || !post) {
      return res.status(404).json({ error: 'Post not found or unauthorized' });
    }

    // Use existingImages/existingFiles from body if provided (for removal support)
    let images = [];
    let files = [];
    
    if (req.body.existingImages) {
      try { images = JSON.parse(req.body.existingImages); } catch(e) { images = []; }
    } else {
      images = post.images ? JSON.parse(post.images) : [];
    }
    
    if (req.body.existingFiles) {
      try { files = JSON.parse(req.body.existingFiles); } catch(e) { files = []; }
    } else {
      files = post.files ? JSON.parse(post.files) : [];
    }

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

    // Build update query with all fields
    const updateFields = [
      'content = ?', 'images = ?', 'files = ?', 'updated_at = CURRENT_TIMESTAMP'
    ];
    const updateValues = [content, JSON.stringify(images), JSON.stringify(files)];
    
    // Hashtags
    if (hashtags) {
      updateFields.push('hashtags = ?');
      updateValues.push(hashtags);
    }
    
    // Schedule
    if (scheduled_at !== undefined) {
      updateFields.push('scheduled_at = ?');
      updateValues.push(scheduled_at || null);
    }
    
    // Advanced options
    if (enable_contact !== undefined) {
      updateFields.push('enable_contact = ?');
      updateValues.push(enable_contact === '1' || enable_contact === true ? 1 : 0);
    }
    if (enable_interested !== undefined) {
      updateFields.push('enable_interested = ?');
      updateValues.push(enable_interested === '1' || enable_interested === true ? 1 : 0);
    }
    
    // Custom button
    if (custom_button !== undefined) {
      updateFields.push('custom_button = ?');
      updateValues.push(custom_button || null);
    }
    
    updateValues.push(postId);

    db.run(
      `UPDATE posts SET ${updateFields.join(', ')} WHERE id = ?`,
      updateValues,
      (err) => {
        if (err) {
          return res.status(500).json({ error: 'Error updating post' });
        }
        
        // Handle poll update/create
        if (poll_question && poll_options) {
          try {
            const options = JSON.parse(poll_options);
            if (options.length >= 2) {
              // Check if poll already exists for this post
              db.get('SELECT * FROM polls WHERE post_id = ?', [postId], (err, existingPoll) => {
                if (existingPoll) {
                  // Update existing poll question, options (keep votes structure)
                  const oldOptions = JSON.parse(existingPoll.options);
                  const oldVotes = JSON.parse(existingPoll.votes);
                  
                  // Build new votes object, preserving votes for unchanged options
                  const newVotes = {};
                  options.forEach(opt => {
                    newVotes[opt] = oldVotes[opt] || 0;
                  });
                  
                  db.run(
                    'UPDATE polls SET question = ?, options = ?, votes = ?, expires_at = ? WHERE post_id = ?',
                    [poll_question, JSON.stringify(options), JSON.stringify(newVotes), poll_expiry || null, postId]
                  );
                } else {
                  // Create new poll
                  const votes = {};
                  options.forEach(opt => { votes[opt] = 0; });
                  db.run(
                    'INSERT INTO polls (post_id, question, options, votes, expires_at) VALUES (?, ?, ?, ?, ?)',
                    [postId, poll_question, JSON.stringify(options), JSON.stringify(votes), poll_expiry || null]
                  );
                }
              });
            }
          } catch(e) { /* ignore parse errors */ }
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
