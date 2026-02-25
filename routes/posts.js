const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const upload = require('../middleware/upload');
const { getDb } = require('../config/database');
const fs = require('fs');
const path = require('path');
const multer = require('multer');

// Lightweight multer for chunk uploads — no logging, writes to temp
const chunkUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, path.join(__dirname, '..', 'uploads', 'temp')),
    filename: (req, file, cb) => cb(null, 'tmp_' + Date.now() + '_' + Math.random().toString(36).slice(2))
  }),
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB per chunk max
});

// ===== Chunked Upload Endpoints =====
// For large video files that exceed proxy limits

// Initialize a chunked upload session
router.post('/upload/init', authMiddleware, (req, res) => {
  const { fileName, fileSize, mimeType, totalChunks } = req.body;
  if (!fileName || !totalChunks) {
    return res.status(400).json({ error: 'fileName and totalChunks required' });
  }
  const uploadId = Date.now() + '-' + Math.round(Math.random() * 1E9);
  const tempDir = path.join(__dirname, '..', 'uploads', 'temp', uploadId);
  fs.mkdirSync(tempDir, { recursive: true });

  const meta = { fileName, fileSize, mimeType, totalChunks: parseInt(totalChunks), receivedChunks: 0, userId: req.user.userId };
  fs.writeFileSync(path.join(tempDir, 'meta.json'), JSON.stringify(meta));

  res.json({ uploadId });
});

// Upload a single chunk — uses lightweight multer
router.post('/upload/chunk', authMiddleware, chunkUpload.single('chunk'), (req, res) => {
  const { uploadId, chunkIndex } = req.body;
  if (!uploadId || chunkIndex === undefined) {
    return res.status(400).json({ error: 'uploadId and chunkIndex required' });
  }

  const tempDir = path.join(__dirname, '..', 'uploads', 'temp', uploadId);
  const metaPath = path.join(tempDir, 'meta.json');
  if (!fs.existsSync(metaPath)) {
    return res.status(404).json({ error: 'Upload session not found' });
  }

  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  if (meta.userId !== req.user.userId) {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  if (req.file) {
    const chunkPath = path.join(tempDir, `chunk_${chunkIndex}`);
    fs.renameSync(req.file.path, chunkPath);
    meta.receivedChunks++;
    fs.writeFileSync(metaPath, JSON.stringify(meta));
  }

  res.json({ received: meta.receivedChunks, total: meta.totalChunks });
});

// Finalize: assemble chunks into final file
router.post('/upload/finalize', authMiddleware, (req, res) => {
  const { uploadId } = req.body;
  if (!uploadId) {
    return res.status(400).json({ error: 'uploadId required' });
  }

  const tempDir = path.join(__dirname, '..', 'uploads', 'temp', uploadId);
  const metaPath = path.join(tempDir, 'meta.json');
  if (!fs.existsSync(metaPath)) {
    return res.status(404).json({ error: 'Upload session not found' });
  }

  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  if (meta.userId !== req.user.userId) {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  // Assemble all chunks
  const ext = path.extname(meta.fileName) || '.mp4';
  const finalName = Date.now() + '-' + Math.round(Math.random() * 1E9) + ext;
  const finalPath = path.join(__dirname, '..', 'uploads', 'images', finalName);

  try {
    const writeStream = fs.createWriteStream(finalPath);
    for (let i = 0; i < meta.totalChunks; i++) {
      const chunkPath = path.join(tempDir, `chunk_${i}`);
      if (!fs.existsSync(chunkPath)) {
        writeStream.close();
        fs.unlinkSync(finalPath);
        return res.status(400).json({ error: `Missing chunk ${i}` });
      }
      const data = fs.readFileSync(chunkPath);
      writeStream.write(data);
    }
    writeStream.end();

    writeStream.on('finish', () => {
      // Clean up temp directory
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch(e) { /* ignore cleanup errors */ }

      res.json({ filePath: `/uploads/images/${finalName}` });
    });

    writeStream.on('error', (err) => {
      res.status(500).json({ error: 'Failed to assemble file' });
    });
  } catch(err) {
    res.status(500).json({ error: 'Failed to assemble file' });
  }
});

// Get all posts (home feed)
router.get('/', authMiddleware, (req, res) => {
  const db = getDb();
  const userId = req.user.userId;

  // Get posts excluding stories that have expired
  // For private accounts: only show posts from users the current user follows, or is_public_post = 1
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
      AND (
        p.user_id = ?
        OR u.is_private = 0
        OR p.is_public_post = 1
        OR EXISTS (SELECT 1 FROM followers WHERE follower_id = ? AND following_id = p.user_id)
      )
    ORDER BY (
      (ABS(RANDOM()) % 1000) / 1000.0
      + CASE WHEN p.created_at >= datetime('now', '-1 day') THEN 0.3
             WHEN p.created_at >= datetime('now', '-3 days') THEN 0.15
             ELSE 0 END
      + (SELECT COUNT(*) FROM post_likes WHERE post_id = p.id) * 0.05
      + (SELECT COUNT(*) FROM post_comments WHERE post_id = p.id) * 0.08
    ) DESC
    LIMIT 50
  `;

  db.all(query, [userId, userId, userId, userId, userId, userId], (err, posts) => {
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
              comment_to_dm: post.comment_to_dm ? JSON.parse(post.comment_to_dm) : null,
              user_has_liked: post.user_has_liked > 0,
              is_saved: post.is_saved > 0,
              poll: {
                ...poll,
                options: parsedOptions,
                votes: JSON.parse(poll.votes),
                user_voted: userVote ? parsedOptions[userVote.option_index] : null
              },
              recent_comments: [],
              recent_liker: null
            };
            // Fetch last 2 comments for inline display
            db.all(
              `SELECT c.id, c.content, c.created_at, c.user_id, u.username, u.profile_picture
               FROM post_comments c JOIN users u ON c.user_id = u.id
               WHERE c.post_id = ? AND c.parent_id IS NULL
               ORDER BY c.created_at DESC LIMIT 2`,
              [post.id],
              (errC, recentComments) => {
                processedPost.recent_comments = (recentComments || []).reverse();
                db.get(
                  `SELECT u.username FROM post_likes pl JOIN users u ON pl.user_id = u.id WHERE pl.post_id = ? ORDER BY pl.created_at DESC LIMIT 1`,
                  [post.id],
                  (errL, liker) => {
                    processedPost.recent_liker = liker ? liker.username : null;
                    processedPosts.push(processedPost);
                    pending--;
                    if (pending === 0) {
                      processedPosts.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
                      res.json({ success: true, posts: processedPosts });
                    }
                  }
                );
              }
            );
          });
          return;
        }
        const processedPost = {
          ...post,
          images: post.images ? JSON.parse(post.images) : [],
          files: post.files ? JSON.parse(post.files) : [],
          hashtags: post.hashtags ? JSON.parse(post.hashtags) : [],
          custom_button: post.custom_button ? JSON.parse(post.custom_button) : null,
          comment_to_dm: post.comment_to_dm ? JSON.parse(post.comment_to_dm) : null,
          user_has_liked: post.user_has_liked > 0,
          is_saved: post.is_saved > 0,
          poll: null,
          recent_comments: [],
          recent_liker: null
        };

        // Fetch last 2 comments for inline display
        db.all(
          `SELECT c.id, c.content, c.created_at, c.user_id, u.username, u.profile_picture
           FROM post_comments c JOIN users u ON c.user_id = u.id
           WHERE c.post_id = ? AND c.parent_id IS NULL
           ORDER BY c.created_at DESC LIMIT 2`,
          [post.id],
          (errC, recentComments) => {
            processedPost.recent_comments = (recentComments || []).reverse();
            // Fetch one recent liker username
            db.get(
              `SELECT u.username FROM post_likes pl JOIN users u ON pl.user_id = u.id WHERE pl.post_id = ? ORDER BY pl.created_at DESC LIMIT 1`,
              [post.id],
              (errL, liker) => {
                processedPost.recent_liker = liker ? liker.username : null;
                processedPosts.push(processedPost);
                pending--;
                if (pending === 0) {
                  processedPosts.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
                  res.json({ success: true, posts: processedPosts });
                }
              }
            );
          }
        );
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
router.post('/', authMiddleware, (req, res, next) => {
  upload.fields([
    { name: 'images', maxCount: 10 },
    { name: 'files', maxCount: 5 },
    { name: 'video', maxCount: 1 }
  ])(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: 'File too large. Maximum size is 100MB.' });
      }
      return res.status(400).json({ error: err.message || 'File upload error' });
    }
    next();
  });
}, (req, res) => {
  const db = getDb();
  const userId = req.user.userId;
  const { 
    content, 
    is_story, 
    is_creator_series,
    scheduled_at, 
    video_url,
    hashtags,
    enable_contact,
    enable_interested,
    poll_question,
    poll_options,
    poll_expiry,
    custom_button,
    comment_to_dm,
    existing_images,
    existing_video,
    is_public_post
  } = req.body;

  let images = [];
  let files = [];
  let videoPath = video_url || existing_video || null;

  // If video was uploaded via chunked upload, use that path
  if (req.body.chunked_video_path) {
    videoPath = req.body.chunked_video_path;
  }

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
      // Fix: if multer saved to files/ folder (for video mimetype), move to images/
      const actualPath = req.files.video[0].path;
      const expectedDir = path.join(__dirname, '..', 'uploads', 'images');
      if (!actualPath.includes('/uploads/images/') && !actualPath.includes('\\uploads\\images\\')) {
        const newPath = path.join(expectedDir, req.files.video[0].filename);
        try { fs.renameSync(actualPath, newPath); } catch(e) { console.error('Failed to move video:', e); }
      }
    }
  }

  // Repost: use existing images/video from original post
  if (existing_images && images.length === 0) {
    try {
      const parsed = JSON.parse(existing_images);
      if (Array.isArray(parsed)) images = parsed;
    } catch (e) { /* ignore parse errors */ }
  }

  // Calculate expiry for stories (24 hours)
  let expires_at = null;
  if (is_story === 'true' || is_story === true) {
    const expiryDate = new Date();
    expiryDate.setHours(expiryDate.getHours() + 24);
    expires_at = expiryDate.toISOString();
  }

  const query = `
    INSERT INTO posts (user_id, content, images, files, video_url, is_story, is_creator_series, scheduled_at, expires_at, hashtags, enable_contact, enable_interested, custom_button, comment_to_dm, is_public_post)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      is_creator_series === 'true' || is_creator_series === true || is_creator_series === '1' ? 1 : 0,
      scheduled_at || null,
      expires_at,
      hashtags || null,
      enable_contact === '1' || enable_contact === true ? 1 : 0,
      enable_interested === '1' || enable_interested === true ? 1 : 0,
      custom_button || null,
      comment_to_dm || null,
      is_public_post === '1' || is_public_post === true ? 1 : 0
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
    try { post.comment_to_dm = post.comment_to_dm ? JSON.parse(post.comment_to_dm) : null; } catch(e) { post.comment_to_dm = null; }
    
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
        // Format hire details as structured data for rich card rendering
        dmContent = `[HIRE_APPLICATION]\n`;
        if (hire_data.name) dmContent += `name::${hire_data.name}\n`;
        if (hire_data.email) dmContent += `email::${hire_data.email}\n`;
        if (hire_data.contact) dmContent += `contact::${hire_data.contact}\n`;
        if (hire_data.resume_link) dmContent += `resume::${hire_data.resume_link}\n`;
        if (hire_data.custom_fields && Object.keys(hire_data.custom_fields).length > 0) {
          for (const [key, value] of Object.entries(hire_data.custom_fields)) {
            if (value) dmContent += `custom::${key}::${value}\n`;
          }
        }
        dmContent += `from::@${actingUser.username}\n`;
        dmContent += `[/HIRE_APPLICATION]`;
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
      db.get('SELECT user_id, comment_to_dm, username FROM posts p JOIN users u ON p.user_id = u.id WHERE p.id = ?', [postId], (err, post) => {
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

        // Comment-to-DM: always send DM with buttons to commenter
        if (post && post.comment_to_dm && post.user_id !== userId) {
          try {
            const cdmConfig = JSON.parse(post.comment_to_dm);
            if (cdmConfig.enabled) {
              // Always send DM with buttons — follow check happens when button is clicked
              sendCommentDMWithButtons(db, post.user_id, userId, cdmConfig, post.username, postId, req.app.get('io'));
            }
          } catch (e) {
            console.error('Comment-to-DM error:', e);
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

  // First get the post owner
  db.get('SELECT user_id FROM posts WHERE id = ?', [postId], (err0, post) => {
    if (err0 || !post) return res.status(404).json({ error: 'Post not found' });

    const userId = req.user.userId;
    const query = `
      SELECT c.*, u.username, u.profile_picture,
        (SELECT COUNT(*) FROM comment_likes WHERE comment_id = c.id) as likes_count,
        (SELECT COUNT(*) FROM comment_likes WHERE comment_id = c.id AND user_id = ?) as user_has_liked
      FROM post_comments c
      JOIN users u ON c.user_id = u.id
      WHERE c.post_id = ?
      ORDER BY c.created_at ASC
    `;

    db.all(query, [userId, postId], (err, comments) => {
      if (err) {
        // Fallback if comment_likes table doesn't exist yet
        const fallbackQuery = `
          SELECT c.*, u.username, u.profile_picture, 0 as likes_count, 0 as user_has_liked
          FROM post_comments c
          JOIN users u ON c.user_id = u.id
          WHERE c.post_id = ?
          ORDER BY c.created_at ASC
        `;
        return db.all(fallbackQuery, [postId], (err2, comments2) => {
          if (err2) return res.status(500).json({ error: 'Error fetching comments' });
          res.json({ success: true, comments: comments2, post_user_id: post.user_id });
        });
      }
      res.json({ success: true, comments, post_user_id: post.user_id });
    });
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

      // Also create a unified reminder entry
      db.run(
        `INSERT INTO user_reminders (user_id, title, description, reminder_date, type, source_type, source_id, color)
         VALUES (?, ?, ?, ?, 'post_reminder', 'post', ?, '#ff6b6b')`,
        [userId, message || 'Post Reminder', 'Gentle reminder from post', reminder_date, postId],
        (err) => {
          if (err) console.error('Error creating unified reminder:', err);
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
  const { content, poll_question, poll_options, poll_expiry, scheduled_at, enable_contact, enable_interested, hashtags, custom_button, comment_to_dm, is_public_post } = req.body;

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

    // Comment-to-DM
    if (comment_to_dm !== undefined) {
      updateFields.push('comment_to_dm = ?');
      updateValues.push(comment_to_dm || null);
    }

    // Post Public toggle for private accounts
    if (is_public_post !== undefined) {
      updateFields.push('is_public_post = ?');
      updateValues.push(is_public_post === '1' || is_public_post === true ? 1 : 0);
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

// Unarchive post
router.put('/:postId/unarchive', authMiddleware, (req, res) => {
  const db = getDb();
  const userId = req.user.userId;
  const { postId } = req.params;

  db.run(
    'UPDATE posts SET is_archived = 0 WHERE id = ? AND user_id = ?',
    [postId, userId],
    function(err) {
      if (err) {
        return res.status(500).json({ error: 'Error unarchiving post' });
      }
      if (this.changes === 0) {
        return res.status(404).json({ error: 'Post not found or unauthorized' });
      }
      res.json({ success: true });
    }
  );
});

// Get archived posts for current user
router.get('/archived/list', authMiddleware, (req, res) => {
  const db = getDb();
  const userId = req.user.userId;

  const query = `
    SELECT p.*, u.username, u.profile_picture,
           (SELECT COUNT(*) FROM post_likes WHERE post_id = p.id) as likes_count,
           (SELECT COUNT(*) FROM post_comments WHERE post_id = p.id) as comments_count
    FROM posts p
    JOIN users u ON p.user_id = u.id
    WHERE p.user_id = ? AND p.is_archived = 1 AND p.is_story = 0
    ORDER BY p.created_at DESC
  `;

  db.all(query, [userId], (err, posts) => {
    if (err) {
      return res.status(500).json({ error: 'Error fetching archived posts' });
    }
    posts = posts.map(post => ({
      ...post,
      images: post.images ? JSON.parse(post.images) : [],
      files: post.files ? JSON.parse(post.files) : []
    }));
    res.json({ success: true, posts });
  });
});

// Delete comment
router.delete('/:postId/comments/:commentId', authMiddleware, (req, res) => {
  const db = getDb();
  const userId = req.user.userId;
  const { postId, commentId } = req.params;

  // Allow comment owner or post owner to delete
  db.get('SELECT user_id FROM posts WHERE id = ?', [postId], (err, post) => {
    if (err || !post) return res.status(404).json({ error: 'Post not found' });

    db.get('SELECT user_id FROM post_comments WHERE id = ? AND post_id = ?', [commentId, postId], (err2, comment) => {
      if (err2 || !comment) return res.status(404).json({ error: 'Comment not found' });

      if (comment.user_id !== userId && post.user_id !== userId) {
        return res.status(403).json({ error: 'Not authorized to delete this comment' });
      }

      db.run('DELETE FROM post_comments WHERE id = ?', [commentId], function(err3) {
        if (err3) return res.status(500).json({ error: 'Error deleting comment' });
        db.run('UPDATE posts SET comments_count = MAX(0, comments_count - 1) WHERE id = ?', [postId]);
        res.json({ success: true });
      });
    });
  });
});

// Reply to comment
router.post('/:postId/comments/:commentId/reply', authMiddleware, (req, res) => {
  const db = getDb();
  const userId = req.user.userId;
  const { postId, commentId } = req.params;
  const { content } = req.body;

  if (!content || !content.trim()) {
    return res.status(400).json({ error: 'Reply content required' });
  }

  // Instagram-style: always flatten replies under the root (top-level) comment.
  // If replying to a reply, resolve to its root parent_id.
  db.get('SELECT id, parent_id, user_id FROM post_comments WHERE id = ?', [commentId], (errP, targetComment) => {
    if (errP || !targetComment) return res.status(404).json({ error: 'Comment not found' });

    // If the target already has a parent, use that parent (the root). Otherwise use target's own id.
    const rootParentId = targetComment.parent_id ? targetComment.parent_id : targetComment.id;

    db.run(
      'INSERT INTO post_comments (post_id, user_id, content, parent_id) VALUES (?, ?, ?, ?)',
      [postId, userId, content.trim(), rootParentId],
      function(err) {
        if (err) {
          if (err.message && err.message.includes('parent_id')) {
            db.run(
              'INSERT INTO post_comments (post_id, user_id, content) VALUES (?, ?, ?)',
              [postId, userId, content.trim()],
              function(err2) {
                if (err2) return res.status(500).json({ error: 'Error adding reply' });
                db.run('UPDATE posts SET comments_count = comments_count + 1 WHERE id = ?', [postId]);
                res.json({ success: true, commentId: this.lastID });
              }
            );
            return;
          }
          return res.status(500).json({ error: 'Error adding reply' });
        }

        db.run('UPDATE posts SET comments_count = comments_count + 1 WHERE id = ?', [postId]);

        // Notify the comment author being replied to
        if (targetComment.user_id !== userId) {
          db.run(
            'INSERT INTO notifications (user_id, type, content, related_id, created_by) VALUES (?, ?, ?, ?, ?)',
            [targetComment.user_id, 'reply', 'replied to your comment', postId, userId]
          );
          const io = req.app.get('io');
          if (io) {
            io.to(`user_${targetComment.user_id}`).emit('notification:receive', {
              type: 'reply',
              content: 'replied to your comment',
              post_id: postId,
              created_by: userId
            });
          }
        }

        res.json({ success: true, commentId: this.lastID });
      }
    );
  });
});

// Like/unlike a comment
router.post('/:postId/comments/:commentId/like', authMiddleware, (req, res) => {
  const db = getDb();
  const userId = req.user.userId;
  const { commentId } = req.params;

  // Check if already liked
  db.get('SELECT id FROM comment_likes WHERE comment_id = ? AND user_id = ?', [commentId, userId], (err, existing) => {
    if (err) return res.status(500).json({ error: 'Database error' });

    if (existing) {
      // Unlike
      db.run('DELETE FROM comment_likes WHERE comment_id = ? AND user_id = ?', [commentId, userId], (err2) => {
        if (err2) return res.status(500).json({ error: 'Error unliking comment' });
        db.get('SELECT COUNT(*) as count FROM comment_likes WHERE comment_id = ?', [commentId], (err3, row) => {
          res.json({ success: true, liked: false, likes_count: row ? row.count : 0 });
        });
      });
    } else {
      // Like
      db.run('INSERT INTO comment_likes (comment_id, user_id) VALUES (?, ?)', [commentId, userId], (err2) => {
        if (err2) return res.status(500).json({ error: 'Error liking comment' });
        db.get('SELECT COUNT(*) as count FROM comment_likes WHERE comment_id = ?', [commentId], (err3, row) => {
          res.json({ success: true, liked: true, likes_count: row ? row.count : 0 });
        });
      });
    }
  });
});

// Handle @mention notifications in comments
router.post('/:postId/mention', authMiddleware, (req, res) => {
  const db = getDb();
  const userId = req.user.userId;
  const { postId } = req.params;
  const { mentioned_username } = req.body;

  if (!mentioned_username) {
    return res.status(400).json({ error: 'Username required' });
  }

  db.get('SELECT id FROM users WHERE username = ?', [mentioned_username], (err, mentionedUser) => {
    if (err || !mentionedUser) return res.status(404).json({ error: 'User not found' });

    if (mentionedUser.id === userId) return res.json({ success: true }); // Don't notify self

    db.get('SELECT username FROM users WHERE id = ?', [userId], (err2, sender) => {
      db.run(
        'INSERT INTO notifications (user_id, type, content, related_id, created_by) VALUES (?, ?, ?, ?, ?)',
        [mentionedUser.id, 'mention', `${sender?.username || 'Someone'} mentioned you in a comment`, postId, userId]
      );

      const io = req.app.get('io');
      if (io) {
        io.to(`user_${mentionedUser.id}`).emit('notification:receive', {
          type: 'mention',
          content: `${sender?.username || 'Someone'} mentioned you in a comment`,
          post_id: postId,
          created_by: userId
        });
      }

      res.json({ success: true });
    });
  });
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

// ========== Comment-to-DM Helper Functions ==========

// Always send DM with buttons when someone comments
function sendCommentDMWithButtons(db, postOwnerId, commenterId, cdmConfig, ownerUsername, postId, io) {
  const items = cdmConfig.items || [];
  // Normalize legacy camelCase field names
  const requireFollow = cdmConfig.require_follow || cdmConfig.requireFollow || false;
  const notFollowMsg = cdmConfig.not_following_msg || cdmConfig.notFollowingMsg || '';
  const dmMessage = cdmConfig.dm_message || cdmConfig.dmMessage || '';

  let dmContent = `[CDM_BUTTONS]\n`;
  dmContent += `owner::@${ownerUsername}\n`;
  dmContent += `post_id::${postId}\n`;
  dmContent += `require_follow::${requireFollow ? '1' : '0'}\n`;
  if (dmMessage) dmContent += `dm_message::${dmMessage}\n`;
  items.forEach(item => {
    dmContent += `button::${item.label}::${item.content}\n`;
  });
  dmContent += `[/CDM_BUTTONS]`;

  db.run(
    'INSERT INTO messages (sender_id, receiver_id, content, attachments) VALUES (?, ?, ?, ?)',
    [postOwnerId, commenterId, dmContent, '[]'],
    function(err) {
      if (!err && io) {
        db.get('SELECT username, profile_picture FROM users WHERE id = ?', [postOwnerId], (e, sender) => {
          io.to(`user-${commenterId}`).emit('message:receive', {
            id: this.lastID,
            sender_id: postOwnerId,
            receiver_id: commenterId,
            content: dmContent,
            sender_username: sender?.username,
            sender_profile_picture: sender?.profile_picture,
            created_at: new Date().toISOString()
          });
        });
      }
    }
  );
}

// When user clicks a button, check follow + send appropriate DM
router.post('/:postId/cdm-button-click', authMiddleware, (req, res) => {
  const db = getDb();
  const userId = req.user.userId;
  const { postId } = req.params;
  const { buttonLabel, buttonContent } = req.body;

  db.get('SELECT p.user_id, p.comment_to_dm, u.username FROM posts p JOIN users u ON p.user_id = u.id WHERE p.id = ?', [postId], (err, post) => {
    if (err || !post) return res.status(404).json({ error: 'Post not found' });
    if (!post.comment_to_dm) return res.status(400).json({ error: 'No Comment-to-DM config' });

    let cdmConfig;
    try { cdmConfig = JSON.parse(post.comment_to_dm); } catch(e) { return res.status(400).json({ error: 'Invalid config' }); }

    if (cdmConfig.require_follow) {
      // Check if user follows the post owner
      db.get('SELECT id FROM followers WHERE follower_id = ? AND following_id = ?', [userId, post.user_id], (err, followRow) => {
        if (!followRow) {
          // NOT following — send follow prompt DM
          const defaultMsg = `Oh no! It seems you're not following me 😭 It would really mean a lot if you visit my profile and hit the follow button 🥺 . Once you have done that, click on the 'I'm following' button below and you will get the link ✨ .`;
          const customMsg = cdmConfig.not_following_msg || defaultMsg;

          let dmContent = `[CDM_FOLLOW_PROMPT]\n`;
          dmContent += `msg::${customMsg}\n`;
          dmContent += `owner::@${post.username}\n`;
          dmContent += `post_id::${postId}\n`;
          dmContent += `[/CDM_FOLLOW_PROMPT]`;

          db.run(
            'INSERT INTO messages (sender_id, receiver_id, content, attachments) VALUES (?, ?, ?, ?)',
            [post.user_id, userId, dmContent, '[]'],
            function(err2) {
              const io = req.app.get('io');
              if (!err2 && io) {
                io.to(`user-${userId}`).emit('message:receive', {
                  id: this.lastID,
                  sender_id: post.user_id,
                  receiver_id: userId,
                  content: dmContent,
                  sender_username: post.username,
                  created_at: new Date().toISOString()
                });
              }
              return res.json({ success: false, following: false });
            }
          );
        } else {
          // IS following — send the actual content for that button
          const customMsg = cdmConfig.dm_message || 'Here is the content ✨';
          let dmContent = `[CDM_CONTENT]\n`;
          dmContent += `from::@${post.username}\n`;
          dmContent += `msg::${customMsg}\n`;
          dmContent += `button::${buttonLabel}::${buttonContent}\n`;
          dmContent += `[/CDM_CONTENT]`;

          db.run(
            'INSERT INTO messages (sender_id, receiver_id, content, attachments) VALUES (?, ?, ?, ?)',
            [post.user_id, userId, dmContent, '[]'],
            function(err2) {
              const io = req.app.get('io');
              if (!err2 && io) {
                io.to(`user-${userId}`).emit('message:receive', {
                  id: this.lastID,
                  sender_id: post.user_id,
                  receiver_id: userId,
                  content: dmContent,
                  sender_username: post.username,
                  created_at: new Date().toISOString()
                });
              }
              return res.json({ success: true, following: true });
            }
          );
        }
      });
    } else {
      // No follow required — send content directly
      const customMsg2 = cdmConfig.dm_message || 'Here is the content ✨';
      let dmContent = `[CDM_CONTENT]\n`;
      dmContent += `from::@${post.username}\n`;
      dmContent += `msg::${customMsg2}\n`;
      dmContent += `button::${buttonLabel}::${buttonContent}\n`;
      dmContent += `[/CDM_CONTENT]`;

      db.run(
        'INSERT INTO messages (sender_id, receiver_id, content, attachments) VALUES (?, ?, ?, ?)',
        [post.user_id, userId, dmContent, '[]'],
        function(err2) {
          const io = req.app.get('io');
          if (!err2 && io) {
            io.to(`user-${userId}`).emit('message:receive', {
              id: this.lastID,
              sender_id: post.user_id,
              receiver_id: userId,
              content: dmContent,
              sender_username: post.username,
              created_at: new Date().toISOString()
            });
          }
          return res.json({ success: true, following: true });
        }
      );
    }
  });
});

// Verify follow and send content (called when user clicks "I'm following")
router.post('/:postId/verify-follow', authMiddleware, (req, res) => {
  const db = getDb();
  const userId = req.user.userId;
  const { postId } = req.params;

  db.get('SELECT p.user_id, p.comment_to_dm, u.username FROM posts p JOIN users u ON p.user_id = u.id WHERE p.id = ?', [postId], (err, post) => {
    if (err || !post) return res.status(404).json({ error: 'Post not found' });
    if (!post.comment_to_dm) return res.status(400).json({ error: 'No Comment-to-DM on this post' });

    let cdmConfig;
    try { cdmConfig = JSON.parse(post.comment_to_dm); } catch(e) { return res.status(400).json({ error: 'Invalid config' }); }

    db.get('SELECT id FROM followers WHERE follower_id = ? AND following_id = ?', [userId, post.user_id], (err, followRow) => {
      if (!followRow) {
        const notFollowMsg = cdmConfig.not_following_msg || `I don't see that you're following me yet 😅 Please make sure to follow my account first, then click 'I'm following' again! ✨`;
        let dmContent = `[CDM_NOT_FOLLOWING]\n`;
        dmContent += `msg::${notFollowMsg}\n`;
        dmContent += `owner::@${post.username}\n`;
        dmContent += `post_id::${postId}\n`;
        dmContent += `[/CDM_NOT_FOLLOWING]`;

        db.run(
          'INSERT INTO messages (sender_id, receiver_id, content, attachments) VALUES (?, ?, ?, ?)',
          [post.user_id, userId, dmContent, '[]'],
          function(err2) {
            const io = req.app.get('io');
            if (!err2 && io) {
              io.to(`user-${userId}`).emit('message:receive', {
                id: this.lastID,
                sender_id: post.user_id,
                receiver_id: userId,
                content: dmContent,
                sender_username: post.username,
                created_at: new Date().toISOString()
              });
            }
            return res.json({ success: false, following: false });
          }
        );
      } else {
        // IS following — send ALL content items
        const items = cdmConfig.items || [];
        const verifyMsg = cdmConfig.dm_message || 'Here is the content ✨';
        let dmContent = `[CDM_CONTENT]\n`;
        dmContent += `from::@${post.username}\n`;
        dmContent += `msg::${verifyMsg}\n`;
        items.forEach(item => {
          dmContent += `button::${item.label}::${item.content}\n`;
        });
        dmContent += `[/CDM_CONTENT]`;

        db.run(
          'INSERT INTO messages (sender_id, receiver_id, content, attachments) VALUES (?, ?, ?, ?)',
          [post.user_id, userId, dmContent, '[]'],
          function(err2) {
            const io = req.app.get('io');
            if (!err2 && io) {
              io.to(`user-${userId}`).emit('message:receive', {
                id: this.lastID,
                sender_id: post.user_id,
                receiver_id: userId,
                content: dmContent,
                sender_username: post.username,
                created_at: new Date().toISOString()
              });
            }
            return res.json({ success: true, following: true });
          }
        );
      }
    });
  });
});

module.exports = router;
