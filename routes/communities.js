const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const upload = require('../middleware/upload');
const { getDb } = require('../config/database');

// Get all communities
router.get('/', authMiddleware, (req, res) => {
  const db = getDb();
  const userId = req.user.userId;
  const { search } = req.query;

  let query = `
    SELECT c.*,
           u.username as admin_username,
           (SELECT COUNT(*) FROM community_members WHERE community_id = c.id) as member_count,
           (SELECT COUNT(*) FROM community_members WHERE community_id = c.id AND user_id = ?) as is_member,
           jr.status as join_request_status
    FROM communities c
    JOIN users u ON c.admin_id = u.id
    LEFT JOIN community_join_requests jr ON c.id = jr.community_id AND jr.user_id = ? AND jr.status = 'pending'
    WHERE 1=1
  `;

  const params = [userId, userId];

  if (search) {
    query += ' AND (c.name LIKE ? OR c.team_name LIKE ? OR c.description LIKE ?)';
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }

  query += ' ORDER BY c.created_at DESC';

  db.all(query, params, (err, communities) => {
    if (err) {
      return res.status(500).json({ error: 'Error fetching communities' });
    }
    res.json({ success: true, communities });
  });
});

// Get user's communities
router.get('/my-communities', authMiddleware, (req, res) => {
  const db = getDb();
  const userId = req.user.userId;

  const query = `
    SELECT c.*,
           u.username as admin_username,
           (SELECT COUNT(*) FROM community_members WHERE community_id = c.id) as member_count,
           cm.role
    FROM communities c
    JOIN users u ON c.admin_id = u.id
    JOIN community_members cm ON c.id = cm.community_id
    WHERE cm.user_id = ?
    ORDER BY c.created_at DESC
  `;

  db.all(query, [userId], (err, communities) => {
    if (err) {
      return res.status(500).json({ error: 'Error fetching communities' });
    }
    res.json({ success: true, communities });
  });
});

// Create community
router.post('/', authMiddleware, (req, res, next) => {
  // Wrap upload middleware with error handling
  upload.single('banner')(req, res, (err) => {
    if (err) {
      console.error('Upload middleware error:', err);
      return res.status(400).json({ 
        error: 'File upload failed', 
        details: err.message 
      });
    }
    next();
  });
}, (req, res) => {
  const db = getDb();
  const userId = req.user.userId;
  const { name, description, team_name, is_public } = req.body;
  
  console.log('=== CREATE COMMUNITY REQUEST ===');
  console.log('User ID:', userId);
  console.log('Body:', { name, description, team_name, is_public });
  console.log('File uploaded:', req.file ? 'YES' : 'NO');
  if (req.file) {
    console.log('File details:', {
      filename: req.file.filename,
      path: req.file.path,
      mimetype: req.file.mimetype,
      size: req.file.size
    });
  }
  
  let banner_image = null;
  if (req.file) {
    // The upload middleware will place it in uploads/community/ folder
    banner_image = `/uploads/community/${req.file.filename}`;
    console.log('Banner image path:', banner_image);
  }
  
  // Parse is_public - could be boolean, string '1'/'0', or string 'true'/'false'
  const isPublicValue = (is_public === '1' || is_public === 1 || is_public === true || is_public === 'true') ? 1 : 0;
  console.log('Parsed is_public value:', isPublicValue);

  const query = `
    INSERT INTO communities (name, description, team_name, banner_image, is_public, admin_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `;

  console.log('Executing query with values:', [name, description, team_name, banner_image, isPublicValue, userId]);

  db.run(query, [name, description, team_name, banner_image, isPublicValue, userId], function(err) {
    if (err) {
      console.error('Database error:', err);
      if (err.message.includes('UNIQUE')) {
        return res.status(400).json({ error: 'Community name already exists' });
      }
      return res.status(500).json({ error: 'Error creating community', details: err.message });
    }

    const communityId = this.lastID;
    console.log('Community created with ID:', communityId);

    // Add creator as admin member
    db.run(
      'INSERT INTO community_members (community_id, user_id, role) VALUES (?, ?, ?)',
      [communityId, userId, 'admin'],
      (err) => {
        if (err) {
          console.error('Error adding admin member:', err);
          return res.status(500).json({ error: 'Error adding admin to community' });
        }

        const response = {
          success: true,
          community: {
            id: communityId,
            name,
            description,
            team_name,
            banner_image,
            is_public: isPublicValue,
            admin_id: userId
          }
        };
        console.log('Sending response:', response);
        res.json(response);
      }
    );
  });
});

// Get community details
router.get('/:communityId', authMiddleware, (req, res) => {
  const db = getDb();
  const { communityId } = req.params;
  const userId = req.user.userId;

  const query = `
    SELECT c.*,
           u.username as admin_username,
           (SELECT COUNT(*) FROM community_members WHERE community_id = c.id) as member_count,
           (SELECT COUNT(*) FROM community_members WHERE community_id = c.id AND user_id = ?) as is_member,
           (SELECT role FROM community_members WHERE community_id = c.id AND user_id = ?) as user_role
    FROM communities c
    JOIN users u ON c.admin_id = u.id
    WHERE c.id = ?
  `;

  db.get(query, [userId, userId, communityId], (err, community) => {
    if (err || !community) {
      return res.status(404).json({ error: 'Community not found' });
    }

    // If not public and user is not a member, restrict access
    if (!community.is_public && !community.is_member) {
      return res.status(403).json({ error: 'This community is private' });
    }

    res.json({ success: true, community });
  });
});

// Join community
router.post('/:communityId/join', authMiddleware, (req, res) => {
  const db = getDb();
  const { communityId } = req.params;
  const userId = req.user.userId;

  // Check if community exists and is public
  db.get('SELECT * FROM communities WHERE id = ? AND is_public = 1', [communityId], (err, community) => {
    if (err || !community) {
      return res.status(404).json({ error: 'Community not found or is private' });
    }

    db.run(
      'INSERT OR IGNORE INTO community_members (community_id, user_id, role) VALUES (?, ?, ?)',
      [communityId, userId, 'member'],
      function(err) {
        if (err) {
          return res.status(500).json({ error: 'Error joining community' });
        }

        // Delete any old community_join notification from this user for this community to prevent duplicates
        db.run(
          'DELETE FROM notifications WHERE user_id = ? AND type = ? AND related_id = ? AND created_by = ?',
          [community.admin_id, 'community_join', communityId, userId],
          function() {
            // Notify admin
            db.run(
              'INSERT INTO notifications (user_id, type, content, related_id, created_by) VALUES (?, ?, ?, ?, ?)',
              [community.admin_id, 'community_join', 'joined your community', communityId, userId]
            );
          }
        );

        res.json({ success: true });
      }
    );
  });
});

// Leave community
router.post('/:communityId/leave', authMiddleware, (req, res) => {
  const db = getDb();
  const { communityId } = req.params;
  const userId = req.user.userId;

  // Check if user is not admin
  db.get('SELECT admin_id FROM communities WHERE id = ?', [communityId], (err, community) => {
    if (community && community.admin_id === userId) {
      return res.status(400).json({ error: 'Admin cannot leave the community. Transfer admin rights first.' });
    }

    // Delete membership
    db.run(
      'DELETE FROM community_members WHERE community_id = ? AND user_id = ?',
      [communityId, userId],
      function(err) {
        if (err) {
          return res.status(500).json({ error: 'Error leaving community' });
        }
        
        // Also clean up any join requests for this user
        db.run(
          'DELETE FROM community_join_requests WHERE community_id = ? AND user_id = ?',
          [communityId, userId],
          (err) => {
            if (err) {
              console.error('Error cleaning up join requests:', err);
            }
          }
        );
        
        // Delete any related notifications
        db.run(
          'DELETE FROM notifications WHERE type = ? AND related_id = ? AND created_by = ?',
          ['join_request', communityId, userId],
          (err) => {
            if (err) {
              console.error('Error cleaning up notifications:', err);
            }
          }
        );
        
        res.json({ success: true });
      }
    );
  });
});

// Get community members
router.get('/:communityId/members', authMiddleware, (req, res) => {
  const db = getDb();
  const { communityId } = req.params;
  const userId = req.user.userId;

  // Check if user is a member or community is public
  db.get('SELECT is_public FROM communities WHERE id = ?', [communityId], (err, community) => {
    if (err || !community) {
      return res.status(404).json({ error: 'Community not found' });
    }

    const query = `
      SELECT cm.*, u.username, u.profile_picture, u.is_online
      FROM community_members cm
      JOIN users u ON cm.user_id = u.id
      WHERE cm.community_id = ?
      ORDER BY cm.role DESC, cm.joined_at ASC
    `;

    db.all(query, [communityId], (err, members) => {
      if (err) {
        return res.status(500).json({ error: 'Error fetching members' });
      }
      res.json({ success: true, members });
    });
  });
});

// Get community posts
router.get('/:communityId/posts', authMiddleware, (req, res) => {
  const db = getDb();
  const { communityId } = req.params;

  const query = `
    SELECT cp.*, u.username, u.profile_picture
    FROM community_posts cp
    JOIN users u ON cp.user_id = u.id
    WHERE cp.community_id = ?
    ORDER BY cp.created_at DESC
  `;

  db.all(query, [communityId], (err, posts) => {
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

// Create community post
router.post('/:communityId/posts', authMiddleware, upload.fields([
  { name: 'images', maxCount: 10 },
  { name: 'files', maxCount: 5 }
]), (req, res) => {
  const db = getDb();
  const { communityId } = req.params;
  const userId = req.user.userId;
  const { content } = req.body;

  // Verify membership
  db.get('SELECT * FROM community_members WHERE community_id = ? AND user_id = ?', [communityId, userId], (err, member) => {
    if (err || !member) {
      return res.status(403).json({ error: 'You must be a member to post' });
    }

    let images = [];
    let files = [];

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
    }

    const query = `
      INSERT INTO community_posts (community_id, user_id, content, images, files)
      VALUES (?, ?, ?, ?, ?)
    `;

    db.run(query, [communityId, userId, content, JSON.stringify(images), JSON.stringify(files)], function(err) {
      if (err) {
        return res.status(500).json({ error: 'Error creating post' });
      }

      res.json({
        success: true,
        post: {
          id: this.lastID,
          content,
          images,
          files,
          created_at: new Date().toISOString()
        }
      });
    });
  });
});

// Get community chat
router.get('/:communityId/chat', authMiddleware, (req, res) => {
  const db = getDb();
  const { communityId } = req.params;

  const query = `
    SELECT cc.*, u.username, u.profile_picture
    FROM community_chat cc
    JOIN users u ON cc.user_id = u.id
    WHERE cc.community_id = ?
    ORDER BY cc.created_at ASC
    LIMIT 100
  `;

  db.all(query, [communityId], (err, messages) => {
    if (err) {
      return res.status(500).json({ error: 'Error fetching chat' });
    }

    messages = messages.map(msg => ({
      ...msg,
      attachments: msg.attachments ? JSON.parse(msg.attachments) : []
    }));

    res.json({ success: true, messages });
  });
});

// Send community chat message
router.post('/:communityId/chat', authMiddleware, upload.array('attachments', 5), (req, res) => {
  const db = getDb();
  const { communityId } = req.params;
  const userId = req.user.userId;
  const { message } = req.body;

  // Verify membership
  db.get('SELECT * FROM community_members WHERE community_id = ? AND user_id = ?', [communityId, userId], (err, member) => {
    if (err || !member) {
      return res.status(403).json({ error: 'You must be a member to chat' });
    }

    let attachments = [];
    if (req.files) {
      attachments = req.files.map(file => ({
        name: file.originalname,
        path: file.mimetype.startsWith('image/') ? `/uploads/images/${file.filename}` : `/uploads/files/${file.filename}`,
        type: file.mimetype
      }));
    }

    db.run(
      'INSERT INTO community_chat (community_id, user_id, message, attachments) VALUES (?, ?, ?, ?)',
      [communityId, userId, message, JSON.stringify(attachments)],
      function(err) {
        if (err) {
          return res.status(500).json({ error: 'Error sending message' });
        }

        res.json({
          success: true,
          chatMessage: {
            id: this.lastID,
            message,
            attachments,
            created_at: new Date().toISOString()
          }
        });
      }
    );
  });
});

// Get community files
router.get('/:communityId/files', authMiddleware, (req, res) => {
  const db = getDb();
  const { communityId } = req.params;

  const query = `
    SELECT cf.*, u.username
    FROM community_files cf
    JOIN users u ON cf.user_id = u.id
    WHERE cf.community_id = ?
    ORDER BY cf.created_at DESC
  `;

  db.all(query, [communityId], (err, files) => {
    if (err) {
      return res.status(500).json({ error: 'Error fetching files' });
    }
    res.json({ success: true, files });
  });
});

// Upload community file
router.post('/:communityId/files', authMiddleware, upload.single('file'), (req, res) => {
  const db = getDb();
  const { communityId } = req.params;
  const userId = req.user.userId;

  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  // Verify membership
  db.get('SELECT * FROM community_members WHERE community_id = ? AND user_id = ?', [communityId, userId], (err, member) => {
    if (err || !member) {
      return res.status(403).json({ error: 'You must be a member to upload files' });
    }

    const filepath = req.file.mimetype.startsWith('image/') 
      ? `/uploads/images/${req.file.filename}`
      : `/uploads/files/${req.file.filename}`;

    db.run(
      'INSERT INTO community_files (community_id, user_id, filename, filepath, filesize) VALUES (?, ?, ?, ?, ?)',
      [communityId, userId, req.file.originalname, filepath, req.file.size],
      function(err) {
        if (err) {
          return res.status(500).json({ error: 'Error uploading file' });
        }

        res.json({
          success: true,
          file: {
            id: this.lastID,
            filename: req.file.originalname,
            filepath,
            filesize: req.file.size
          }
        });
      }
    );
  });
});

// Get community announcements
router.get('/:communityId/announcements', authMiddleware, (req, res) => {
  const db = getDb();
  const { communityId } = req.params;
  const userId = req.user.userId;

  db.get(
    `SELECT c.is_public,
            (SELECT COUNT(*) FROM community_members WHERE community_id = c.id AND user_id = ?) as is_member
     FROM communities c
     WHERE c.id = ?`,
    [userId, communityId],
    (err, access) => {
      if (err || !access) return res.status(404).json({ error: 'Community not found' });
      if (!access.is_public && !access.is_member) {
        return res.status(403).json({ error: 'This community is private' });
      }

      const query = `
        SELECT ca.*, u.username as author_username, u.profile_picture as author_profile_picture
        FROM community_announcements ca
        JOIN users u ON ca.author_id = u.id
        WHERE ca.community_id = ?
        ORDER BY ca.is_pinned DESC, ca.created_at DESC
      `;

      db.all(query, [communityId], (e, rows) => {
        if (e) return res.status(500).json({ error: 'Error fetching announcements' });
        res.json({ success: true, announcements: rows });
      });
    }
  );
});

// Create community announcement (admin/moderator)
router.post('/:communityId/announcements', authMiddleware, upload.array('files', 10), (req, res) => {
  const db = getDb();
  const { communityId } = req.params;
  const userId = req.user.userId;
  
  console.log('📥 Raw req.body:', JSON.stringify(req.body, null, 2));
  console.log('📥 req.body.attachments type:', typeof req.body.attachments);
  console.log('📥 req.body.attachments value:', req.body.attachments);
  
  const { title, body = '', is_pinned = 0, attachments: attachmentsJson } = req.body || {};

  console.log('📥 Parsed values:', {
    title,
    body: body ? body.substring(0, 50) + '...' : '(empty)',
    attachmentsJson,
    filesCount: req.files ? req.files.length : 0
  });

  if (!title) return res.status(400).json({ error: 'title is required' });

  db.get(
    'SELECT role FROM community_members WHERE community_id = ? AND user_id = ?',
    [communityId, userId],
    (err, member) => {
      if (err || !member) return res.status(403).json({ error: 'You must be a member to post announcements' });
      if (!['admin', 'moderator'].includes(member.role)) {
        return res.status(403).json({ error: 'Only admins/moderators can post announcements' });
      }

      // Process attachments
      let attachmentsData = {};
      try {
        if (attachmentsJson) {
          attachmentsData = JSON.parse(attachmentsJson);
        }
      } catch (e) {
        attachmentsData = {};
      }

      // Add uploaded files to attachments
      if (req.files && req.files.length > 0) {
        // Files are saved to ./uploads/community/ by multer for community/announcement routes
        // Extract the actual path from multer's file.path
        attachmentsData.files = req.files.map(file => {
          // Use the actual path from multer, convert to URL path
          let urlPath = file.path.replace(/\\/g, '/'); // normalize backslashes
          if (urlPath.startsWith('uploads/')) {
            urlPath = '/' + urlPath; // add leading slash
          } else if (!urlPath.startsWith('/uploads/')) {
            urlPath = '/uploads/community/' + file.filename; // fallback to community folder
          }
          
          return {
            name: file.originalname,
            url: urlPath,
            size: `${(file.size / 1024).toFixed(1)} KB`,
            type: file.mimetype
          };
        });
      }

      const attachmentsString = JSON.stringify(attachmentsData);

      db.run(
        `INSERT INTO community_announcements (community_id, author_id, title, body, is_pinned, attachments)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [communityId, userId, title, body, is_pinned ? 1 : 0, attachmentsString],
        function(e) {
          if (e) return res.status(500).json({ error: 'Error creating announcement' });
          res.json({
            success: true,
            announcement: {
              id: this.lastID,
              community_id: Number(communityId),
              author_id: userId,
              title,
              body,
              is_pinned: is_pinned ? 1 : 0,
              attachments: attachmentsString
            }
          });
        }
      );
    }
  );
});

// Update/pin/unpin announcement (admin/moderator)
router.patch('/:communityId/announcements/:announcementId', authMiddleware, (req, res) => {
  const db = getDb();
  const { communityId, announcementId } = req.params;
  const userId = req.user.userId;
  const { title, body, is_pinned } = req.body || {};

  db.get(
    'SELECT role FROM community_members WHERE community_id = ? AND user_id = ?',
    [communityId, userId],
    (err, member) => {
      if (err || !member) return res.status(403).json({ error: 'You must be a member' });
      if (!['admin', 'moderator'].includes(member.role)) {
        return res.status(403).json({ error: 'Only admins/moderators can update announcements' });
      }

      db.get(
        'SELECT * FROM community_announcements WHERE id = ? AND community_id = ?',
        [announcementId, communityId],
        (e, existing) => {
          if (e || !existing) return res.status(404).json({ error: 'Announcement not found' });

          const nextTitle = typeof title === 'string' ? title : existing.title;
          const nextBody = typeof body === 'string' ? body : existing.body;
          const nextPinned = typeof is_pinned === 'undefined' ? existing.is_pinned : (is_pinned ? 1 : 0);

          db.run(
            `UPDATE community_announcements
             SET title = ?, body = ?, is_pinned = ?, updated_at = CURRENT_TIMESTAMP
             WHERE id = ? AND community_id = ?`,
            [nextTitle, nextBody, nextPinned, announcementId, communityId],
            (uErr) => {
              if (uErr) return res.status(500).json({ error: 'Error updating announcement' });
              res.json({ success: true });
            }
          );
        }
      );
    }
  );
});

// Delete announcement (admin/moderator/author)
router.delete('/:communityId/announcements/:announcementId', authMiddleware, (req, res) => {
  const db = getDb();
  const { communityId, announcementId } = req.params;
  const userId = req.user.userId;

  // Check if user is member with proper role
  db.get(
    'SELECT role FROM community_members WHERE community_id = ? AND user_id = ?',
    [communityId, userId],
    (err, member) => {
      if (err || !member) return res.status(403).json({ error: 'You must be a member' });

      // Check if user is author or admin/moderator
      db.get(
        'SELECT * FROM community_announcements WHERE id = ? AND community_id = ?',
        [announcementId, communityId],
        (e, existing) => {
          if (e || !existing) return res.status(404).json({ error: 'Announcement not found' });

          const isAuthor = existing.author_id === userId;
          const isAdminOrMod = member.role === 'admin' || member.role === 'moderator';

          if (!isAuthor && !isAdminOrMod) {
            return res.status(403).json({ error: 'Only author or admins/moderators can delete' });
          }

          db.run(
            'DELETE FROM community_announcements WHERE id = ?',
            [announcementId],
            function(err2) {
              if (err2) return res.status(500).json({ error: 'Error deleting announcement' });
              res.json({ success: true });
            }
          );
        }
      );
    }
  );
});

// Vote on poll
router.post('/:communityId/announcements/:announcementId/vote', authMiddleware, (req, res) => {
  const db = getDb();
  const { communityId, announcementId } = req.params;
  const { optionIndex } = req.body;
  const userId = req.user.userId;

  if (typeof optionIndex !== 'number' || optionIndex < 0) {
    return res.status(400).json({ error: 'Invalid option index' });
  }

  // Check if user is member
  db.get(
    'SELECT role FROM community_members WHERE community_id = ? AND user_id = ?',
    [communityId, userId],
    (err, member) => {
      if (err || !member) return res.status(403).json({ error: 'You must be a member to vote' });

      // Get announcement
      db.get(
        'SELECT * FROM community_announcements WHERE id = ? AND community_id = ?',
        [announcementId, communityId],
        (err, announcement) => {
          if (err || !announcement) {
            return res.status(404).json({ error: 'Announcement not found' });
          }

          let attachments = {};
          try {
            attachments = JSON.parse(announcement.attachments || '{}');
          } catch (e) {
            attachments = {};
          }

          if (!attachments.poll) {
            return res.status(400).json({ error: 'This announcement has no poll' });
          }

          // Validate option index
          if (optionIndex >= attachments.poll.options.length) {
            return res.status(400).json({ error: 'Invalid option index' });
          }

          // Initialize votes structure if not exists
          if (!attachments.poll.votes) {
            attachments.poll.votes = [];
          }

          // Remove any previous vote from this user
          attachments.poll.votes = attachments.poll.votes.filter(vote => vote.userId !== userId);

          // Add new vote
          attachments.poll.votes.push({
            userId: userId,
            optionIndex: optionIndex,
            timestamp: new Date().toISOString()
          });

          // Calculate vote counts
          const voteCounts = new Array(attachments.poll.options.length).fill(0);
          attachments.poll.votes.forEach(vote => {
            if (vote.optionIndex >= 0 && vote.optionIndex < voteCounts.length) {
              voteCounts[vote.optionIndex]++;
            }
          });

          // Update announcement
          db.run(
            'UPDATE community_announcements SET attachments = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
            [JSON.stringify(attachments), announcementId],
            function(err) {
              if (err) {
                console.error('Vote update error:', err);
                return res.status(500).json({ error: 'Error recording vote' });
              }

              const totalVotes = attachments.poll.votes.length;
              const results = {
                options: attachments.poll.options,
                voteCounts: voteCounts,
                totalVotes: totalVotes,
                userVote: optionIndex,
                percentages: voteCounts.map(count => totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0)
              };

              // Emit socket event for real-time updates
              const io = req.app.get('io');
              if (io) {
                io.to(`community_${communityId}`).emit('poll:voted', {
                  announcementId,
                  results
                });
              }

              res.json({ success: true, results });
            }
          );
        }
      );
    }
  );
});

// ==================== ANNOUNCEMENT REACTIONS ====================
// Add reaction to announcement
router.post('/:communityId/announcements/:announcementId/reactions', authMiddleware, (req, res) => {
  const db = getDb();
  const { communityId, announcementId } = req.params;
  const { reaction_type } = req.body;
  const userId = req.user.userId;

  const validReactions = ['like', 'love', 'care', 'haha', 'wow', 'sad', 'angry'];
  if (!validReactions.includes(reaction_type)) {
    return res.status(400).json({ error: 'Invalid reaction type' });
  }

  db.get('SELECT role FROM community_members WHERE community_id = ? AND user_id = ?',
    [communityId, userId],
    (err, member) => {
      if (err || !member) return res.status(403).json({ error: 'You must be a member' });

      db.run(
        'INSERT OR REPLACE INTO announcement_reactions (announcement_id, user_id, reaction_type) VALUES (?, ?, ?)',
        [announcementId, userId, reaction_type],
        function(err) {
          if (err) return res.status(500).json({ error: 'Error adding reaction' });
          
          // Get updated reaction counts
          db.all(
            'SELECT reaction_type, COUNT(*) as count FROM announcement_reactions WHERE announcement_id = ? GROUP BY reaction_type',
            [announcementId],
            (err, reactions) => {
              const io = req.app.get('io');
              if (io) {
                io.to(`community_${communityId}`).emit('announcement:reaction', {
                  announcementId,
                  reactions: reactions || []
                });
              }
              res.json({ success: true, reactions: reactions || [] });
            }
          );
        }
      );
    }
  );
});

// Remove reaction from announcement
router.delete('/:communityId/announcements/:announcementId/reactions/:reactionType', authMiddleware, (req, res) => {
  const db = getDb();
  const { announcementId, reactionType } = req.params;
  const userId = req.user.userId;

  db.run(
    'DELETE FROM announcement_reactions WHERE announcement_id = ? AND user_id = ? AND reaction_type = ?',
    [announcementId, userId, reactionType],
    function(err) {
      if (err) return res.status(500).json({ error: 'Error removing reaction' });
      res.json({ success: true });
    }
  );
});

// Get announcement reactions
router.get('/:communityId/announcements/:announcementId/reactions', authMiddleware, (req, res) => {
  const db = getDb();
  const { announcementId } = req.params;
  const userId = req.user.userId;

  db.all(
    `SELECT ar.reaction_type, ar.user_id, u.username, u.profile_picture,
            (SELECT reaction_type FROM announcement_reactions WHERE announcement_id = ? AND user_id = ?) as user_reaction
     FROM announcement_reactions ar
     JOIN users u ON ar.user_id = u.id
     WHERE ar.announcement_id = ?
     ORDER BY ar.created_at DESC`,
    [announcementId, userId, announcementId],
    (err, reactions) => {
      if (err) return res.status(500).json({ error: 'Error fetching reactions' });
      
      // Group by reaction type with counts
      const grouped = {};
      reactions.forEach(r => {
        if (!grouped[r.reaction_type]) {
          grouped[r.reaction_type] = { count: 0, users: [] };
        }
        grouped[r.reaction_type].count++;
        grouped[r.reaction_type].users.push({
          id: r.user_id,
          username: r.username,
          profile_picture: r.profile_picture
        });
      });

      const userReaction = reactions.length > 0 ? reactions[0].user_reaction : null;

      res.json({ success: true, reactions: grouped, userReaction });
    }
  );
});

// ==================== ANNOUNCEMENT COMMENTS ====================
// Add comment to announcement
router.post('/:communityId/announcements/:announcementId/comments', authMiddleware, (req, res) => {
  const db = getDb();
  const { communityId, announcementId } = req.params;
  const { content } = req.body;
  const userId = req.user.userId;

  if (!content || !content.trim()) {
    return res.status(400).json({ error: 'Comment content is required' });
  }

  db.get('SELECT role FROM community_members WHERE community_id = ? AND user_id = ?',
    [communityId, userId],
    (err, member) => {
      if (err || !member) return res.status(403).json({ error: 'You must be a member' });

      db.run(
        'INSERT INTO announcement_comments (announcement_id, user_id, content) VALUES (?, ?, ?)',
        [announcementId, userId, content.trim()],
        function(err) {
          if (err) return res.status(500).json({ error: 'Error adding comment' });

          db.get(
            `SELECT ac.*, u.username, u.profile_picture
             FROM announcement_comments ac
             JOIN users u ON ac.user_id = u.id
             WHERE ac.id = ?`,
            [this.lastID],
            (err, comment) => {
              if (err) return res.status(500).json({ error: 'Error fetching comment' });

              const io = req.app.get('io');
              if (io) {
                io.to(`community_${communityId}`).emit('announcement:comment', {
                  announcementId,
                  comment
                });
              }

              res.json({ success: true, comment });
            }
          );
        }
      );
    }
  );
});

// Get announcement comments
router.get('/:communityId/announcements/:announcementId/comments', authMiddleware, (req, res) => {
  const db = getDb();
  const { announcementId } = req.params;

  db.all(
    `SELECT ac.*, u.username, u.profile_picture
     FROM announcement_comments ac
     JOIN users u ON ac.user_id = u.id
     WHERE ac.announcement_id = ?
     ORDER BY ac.created_at ASC`,
    [announcementId],
    (err, comments) => {
      if (err) return res.status(500).json({ error: 'Error fetching comments' });
      res.json({ success: true, comments: comments || [] });
    }
  );
});

// Delete announcement comment
router.delete('/:communityId/announcements/:announcementId/comments/:commentId', authMiddleware, (req, res) => {
  const db = getDb();
  const { communityId, commentId } = req.params;
  const userId = req.user.userId;

  db.get('SELECT role FROM community_members WHERE community_id = ? AND user_id = ?',
    [communityId, userId],
    (err, member) => {
      if (err || !member) return res.status(403).json({ error: 'You must be a member' });

      db.get('SELECT * FROM announcement_comments WHERE id = ?', [commentId], (err, comment) => {
        if (err || !comment) return res.status(404).json({ error: 'Comment not found' });

        const isAuthor = comment.user_id === userId;
        const isAdminOrMod = ['admin', 'moderator'].includes(member.role);

        if (!isAuthor && !isAdminOrMod) {
          return res.status(403).json({ error: 'Only author or admins/moderators can delete' });
        }

        db.run('DELETE FROM announcement_comments WHERE id = ?', [commentId], function(err) {
          if (err) return res.status(500).json({ error: 'Error deleting comment' });
          res.json({ success: true });
        });
      });
    }
  );
});

// Update community profile
router.put('/:id', authMiddleware, upload.single('banner'), async (req, res) => {
  const db = getDb();
  const communityId = req.params.id;
  const userId = req.user.userId;
  const { name, description, is_public, team_name } = req.body;

  // Check if user is admin
  db.get(
    'SELECT * FROM communities WHERE id = ? AND admin_id = ?',
    [communityId, userId],
    (err, community) => {
      if (err) {
        return res.status(500).json({ error: 'Error checking permissions' });
      }
      if (!community) {
        return res.status(403).json({ error: 'Only admin can update community' });
      }

      let updateQuery = 'UPDATE communities SET updated_at = CURRENT_TIMESTAMP';
      const params = [];

      if (name !== undefined) {
        updateQuery += ', name = ?';
        params.push(name);
      }
      if (description !== undefined) {
        updateQuery += ', description = ?';
        params.push(description);
      }
      if (is_public !== undefined) {
        updateQuery += ', is_public = ?';
        params.push(is_public);
      }
      if (team_name !== undefined) {
        updateQuery += ', team_name = ?';
        params.push(team_name);
      }
      if (req.file) {
        updateQuery += ', banner_image = ?';
        params.push(`/uploads/community/${req.file.filename}`);
      }

      updateQuery += ' WHERE id = ?';
      params.push(communityId);

      db.run(updateQuery, params, function(err) {
        if (err) {
          return res.status(500).json({ error: 'Error updating community' });
        }
        
        // Return the updated banner_image path if file was uploaded
        const response = { success: true };
        if (req.file) {
          response.banner_image = `/uploads/community/${req.file.filename}`;
        }
        res.json(response);
      });
    }
  );
});

// Delete community
router.delete('/:id', authMiddleware, (req, res) => {
  const db = getDb();
  const communityId = req.params.id;
  const userId = req.user.userId;

  // Check if user is admin
  db.get(
    'SELECT * FROM communities WHERE id = ? AND admin_id = ?',
    [communityId, userId],
    (err, community) => {
      if (err) {
        return res.status(500).json({ error: 'Error checking permissions' });
      }
      if (!community) {
        return res.status(403).json({ error: 'Only admin can delete community' });
      }

      // Delete community (CASCADE will handle related data)
      db.run('DELETE FROM communities WHERE id = ?', [communityId], function(err) {
        if (err) {
          return res.status(500).json({ error: 'Error deleting community' });
        }
        res.json({ success: true });
      });
    }
  );
});

// Request to join a private community
router.post('/:id/request-join', authMiddleware, (req, res) => {
  const db = getDb();
  const communityId = req.params.id;
  const userId = req.user.userId;

  // Check if community exists and is private
  db.get(
    'SELECT * FROM communities WHERE id = ?',
    [communityId],
    (err, community) => {
      if (err) {
        return res.status(500).json({ error: 'Error checking community' });
      }
      if (!community) {
        return res.status(404).json({ error: 'Community not found' });
      }

      // Check if user is already a member
      db.get(
        'SELECT * FROM community_members WHERE community_id = ? AND user_id = ?',
        [communityId, userId],
        (err, member) => {
          if (err) {
            return res.status(500).json({ error: 'Error checking membership' });
          }
          if (member) {
            return res.status(400).json({ error: 'You are already a member of this community' });
          }

          // Check if request already exists
          db.get(
            'SELECT * FROM community_join_requests WHERE community_id = ? AND user_id = ?',
            [communityId, userId],
            (err, existingRequest) => {
              if (err) {
                return res.status(500).json({ error: 'Error checking existing request' });
              }
              if (existingRequest) {
                if (existingRequest.status === 'pending') {
                  return res.status(400).json({ error: 'You already have a pending request for this community' });
                } else {
                  // Clean up old request (approved or any other status) and related notifications
                  db.run(
                    'DELETE FROM community_join_requests WHERE community_id = ? AND user_id = ?',
                    [communityId, userId],
                    (err) => {
                      if (err) {
                        console.error('Error deleting old request:', err);
                      }
                    }
                  );
                  
                  // Also clean up old notifications
                  db.run(
                    'DELETE FROM notifications WHERE type = ? AND related_id = ? AND created_by = ?',
                    ['join_request', communityId, userId],
                    (err) => {
                      if (err) {
                        console.error('Error deleting old notifications:', err);
                      }
                    }
                  );
                  
                  // Wait a moment for cleanup, then create new request
                  setTimeout(() => {
                    createJoinRequest(communityId, userId, community, db, req, res);
                  }, 100);
                  return;
                }
              }

              // Create join request
              createJoinRequest(communityId, userId, community, db, req, res);
            }
          );
        }
      );
    }
  );
});

// Helper function to create join request
function createJoinRequest(communityId, userId, community, db, req, res) {
  // First, delete any old notifications for this user/community combination to prevent duplicates
  db.run(
    'DELETE FROM notifications WHERE type = ? AND related_id = ? AND created_by = ? AND user_id = ?',
    ['join_request', communityId, userId, community.admin_id],
    (delErr) => {
      if (delErr) {
        console.error('Error deleting old notifications:', delErr);
      }
      
      // Now create the join request
      db.run(
        `INSERT INTO community_join_requests (community_id, user_id, status) 
         VALUES (?, ?, 'pending')`,
        [communityId, userId],
        function(err) {
          if (err) {
            console.error('Error creating join request:', err);
            return res.status(500).json({ error: 'Error creating join request', details: err.message });
          }

          // Create notification for admin
          db.get('SELECT username FROM users WHERE id = ?', [userId], (err, user) => {
            if (!err && user) {
              // Create the new notification
              db.run(
                `INSERT INTO notifications (user_id, type, content, related_id, created_by, created_at) 
                 VALUES (?, 'join_request', ?, ?, ?, CURRENT_TIMESTAMP)`,
                [
                  community.admin_id,
                  `${user.username} requested to join ${community.name}`,
                  communityId,
                  userId
                ],
                function(err) {
                  if (err) {
                    console.error('Error creating notification:', err);
                  }
                }
              );

              // Emit socket event for real-time notification
              const io = req.app.get('io');
              if (io) {
                io.to(`user_${community.admin_id}`).emit('notification:receive', {
                  type: 'join_request',
                  content: `${user.username} requested to join ${community.name}`,
                  related_id: communityId,
                  created_at: new Date().toISOString()
                });
              }
            }
          });

          res.json({ success: true, message: 'Join request sent successfully' });
        }
      );
    }
  );
}

// Get join requests (for private communities)
router.get('/:id/join-requests', authMiddleware, (req, res) => {
  const db = getDb();
  const communityId = req.params.id;
  const userId = req.user.userId;

  // Check if user is admin
  db.get(
    'SELECT * FROM communities WHERE id = ? AND admin_id = ?',
    [communityId, userId],
    (err, community) => {
      if (err) {
        return res.status(500).json({ error: 'Error checking permissions' });
      }
      if (!community) {
        return res.status(403).json({ error: 'Only admin can view join requests' });
      }

      // Get pending join requests
      db.all(
        `SELECT jr.*, u.username, u.profile_picture, u.bio,
         jr.created_at as requested_at
         FROM community_join_requests jr
         JOIN users u ON jr.user_id = u.id
         WHERE jr.community_id = ? AND jr.status = 'pending'
         ORDER BY jr.created_at DESC`,
        [communityId],
        (err, requests) => {
          if (err) {
            return res.status(500).json({ error: 'Error fetching join requests' });
          }
          res.json({ success: true, requests: requests || [] });
        }
      );
    }
  );
});

// Approve join request
router.post('/:id/join-requests/:userId/approve', authMiddleware, (req, res) => {
  const db = getDb();
  const communityId = req.params.id;
  const requestUserId = req.params.userId;
  const adminId = req.user.userId;

  // Check if user is admin
  db.get(
    'SELECT * FROM communities WHERE id = ? AND admin_id = ?',
    [communityId, adminId],
    (err, community) => {
      if (err) {
        return res.status(500).json({ error: 'Error checking permissions' });
      }
      if (!community) {
        return res.status(403).json({ error: 'Only admin can approve requests' });
      }

      // Update request status
      db.run(
        'UPDATE community_join_requests SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE community_id = ? AND user_id = ?',
        ['approved', communityId, requestUserId],
        function(err) {
          if (err) {
            return res.status(500).json({ error: 'Error approving request' });
          }

          // Add user to community members
          db.run(
            'INSERT INTO community_members (community_id, user_id, role) VALUES (?, ?, ?)',
            [communityId, requestUserId, 'member'],
            function(err) {
              if (err) {
                // Ignore if already a member
                console.log('Member already exists or error:', err);
              }
              
              // Clean up the join request after approval
              db.run(
                'DELETE FROM community_join_requests WHERE community_id = ? AND user_id = ?',
                [communityId, requestUserId],
                (err) => {
                  if (err) {
                    console.error('Error cleaning up join request:', err);
                  }
                }
              );
              
              // Delete the notification for this join request
              db.run(
                'DELETE FROM notifications WHERE type = ? AND related_id = ? AND created_by = ?',
                ['join_request', communityId, requestUserId],
                (err) => {
                  if (err) {
                    console.error('Error deleting notification:', err);
                  }
                }
              );
              
              res.json({ success: true });
            }
          );
        }
      );
    }
  );
});

// Decline join request
router.post('/:id/join-requests/:userId/decline', authMiddleware, (req, res) => {
  const db = getDb();
  const communityId = req.params.id;
  const requestUserId = req.params.userId;
  const adminId = req.user.userId;

  // Check if user is admin
  db.get(
    'SELECT * FROM communities WHERE id = ? AND admin_id = ?',
    [communityId, adminId],
    (err, community) => {
      if (err) {
        return res.status(500).json({ error: 'Error checking permissions' });
      }
      if (!community) {
        return res.status(403).json({ error: 'Only admin can decline requests' });
      }

      // Delete the request (instead of marking as declined, to allow re-requesting later)
      db.run(
        'DELETE FROM community_join_requests WHERE community_id = ? AND user_id = ?',
        [communityId, requestUserId],
        function(err) {
          if (err) {
            return res.status(500).json({ error: 'Error declining request' });
          }
          
          // Delete the notification for this join request
          db.run(
            'DELETE FROM notifications WHERE type = ? AND related_id = ? AND created_by = ?',
            ['join_request', communityId, requestUserId],
            (err) => {
              if (err) {
                console.error('Error deleting notification:', err);
              }
            }
          );
          
          res.json({ success: true });
        }
      );
    }
  );
});

// Clear all announcements
router.delete('/:id/announcements/clear', authMiddleware, (req, res) => {
  const db = getDb();
  const communityId = req.params.id;
  const userId = req.user.userId;

  // Check if user is admin
  db.get(
    'SELECT * FROM communities WHERE id = ? AND admin_id = ?',
    [communityId, userId],
    (err, community) => {
      if (err) {
        return res.status(500).json({ error: 'Error checking permissions' });
      }
      if (!community) {
        return res.status(403).json({ error: 'Only admin can clear announcements' });
      }

      // Delete all announcements for this community
      db.run('DELETE FROM community_announcements WHERE community_id = ?', [communityId], function(err) {
        if (err) {
          return res.status(500).json({ error: 'Error clearing announcements' });
        }
        res.json({ success: true });
      });
    }
  );
});

// Accept community invitation
router.post('/:id/accept-invite', authMiddleware, (req, res) => {
  const db = getDb();
  const communityId = req.params.id;
  const userId = req.user.userId;

  // Check if community exists
  db.get('SELECT * FROM communities WHERE id = ?', [communityId], (err, community) => {
    if (err || !community) {
      return res.status(404).json({ error: 'Community not found' });
    }

    // Check if user is already a member
    db.get(
      'SELECT * FROM community_members WHERE community_id = ? AND user_id = ?',
      [communityId, userId],
      (err, member) => {
        if (err) {
          return res.status(500).json({ error: 'Database error' });
        }
        if (member) {
          return res.status(400).json({ error: 'Already a member of this community' });
        }

        // Add user to community
        db.run(
          'INSERT INTO community_members (community_id, user_id, role) VALUES (?, ?, ?)',
          [communityId, userId, 'member'],
          function(err) {
            if (err) {
              return res.status(500).json({ error: 'Error joining community' });
            }

            // Delete old notification for this action to prevent duplicates, then notify admin
            db.run(
              'DELETE FROM notifications WHERE user_id = ? AND type = ? AND related_id = ? AND created_by = ?',
              [community.admin_id, 'community_join', communityId, userId],
              function() {
                db.run(
                  'INSERT INTO notifications (user_id, type, content, related_id, created_by) VALUES (?, ?, ?, ?, ?)',
                  [community.admin_id, 'community_join', 'accepted your invitation and joined', communityId, userId]
                );
              }
            );

            res.json({ success: true, message: 'Successfully joined the community' });
          }
        );
      }
    );
  });
});

// Invite user to community
router.post('/:id/invite', authMiddleware, (req, res) => {
  const db = getDb();
  const communityId = req.params.id;
  const inviterId = req.user.userId;
  const { userId } = req.body;

  // Check if inviter is a member
  db.get(
    'SELECT * FROM community_members WHERE community_id = ? AND user_id = ?',
    [communityId, inviterId],
    (err, member) => {
      if (err) {
        return res.status(500).json({ error: 'Error checking permissions' });
      }
      if (!member) {
        return res.status(403).json({ error: 'Only members can invite others' });
      }

      // Get community details
      db.get('SELECT * FROM communities WHERE id = ?', [communityId], (err, community) => {
        if (err) {
          return res.status(500).json({ error: 'Error fetching community' });
        }

        // Delete any existing invite notification for this user/community to prevent duplicates
        db.run(
          'DELETE FROM notifications WHERE user_id = ? AND type = ? AND related_id = ?',
          [userId, 'community_invite', communityId],
          function() {
            // Create notification for invited user
            db.run(
              'INSERT INTO notifications (user_id, type, content, related_id, created_by) VALUES (?, ?, ?, ?, ?)',
              [userId, 'community_invite', `You've been invited to join ${community.name}`, communityId, inviterId],
              function(err) {
                if (err) {
                  return res.status(500).json({ error: 'Error sending invitation' });
                }

                // Emit socket notification
                const io = req.app.get('io');
                if (io) {
                  io.to(`user_${userId}`).emit('notification:receive', {
                    type: 'community_invite',
                    content: `You've been invited to join ${community.name}`,
                    communityId: communityId
                  });
                }

                res.json({ success: true });
              }
            );
          }
        );
      });
    }
  );
});

// Update member role (promote/demote admin)
router.put('/:communityId/members/:userId/role', authMiddleware, (req, res) => {
  const db = getDb();
  const { communityId, userId } = req.params;
  const targetUserId = parseInt(userId);
  const { role } = req.body; // 'admin' or 'member'
  const currentUserId = req.user.userId;

  // Verify current user is admin
  db.get(
    'SELECT role FROM community_members WHERE community_id = ? AND user_id = ?',
    [communityId, currentUserId],
    (err, member) => {
      if (err || !member || member.role !== 'admin') {
        return res.status(403).json({ error: 'Only admins can change member roles' });
      }

      // Prevent changing own role
      if (parseInt(targetUserId) === currentUserId) {
        return res.status(400).json({ error: 'You cannot change your own role' });
      }

      // Update role
      db.run(
        'UPDATE community_members SET role = ? WHERE community_id = ? AND user_id = ?',
        [role, communityId, targetUserId],
        function(err) {
          if (err) {
            return res.status(500).json({ error: 'Error updating role' });
          }

          if (this.changes === 0) {
            return res.status(404).json({ error: 'Member not found' });
          }

          // Get username for notification
          db.get('SELECT username FROM users WHERE id = ?', [targetUserId], (err, user) => {
            if (!err && user) {
              // Create notification
              const message = role === 'admin' 
                ? 'You have been promoted to admin' 
                : 'Your admin role has been removed';
              
              db.run(
                'INSERT INTO notifications (user_id, type, content, related_id) VALUES (?, ?, ?, ?)',
                [targetUserId, 'community_role_change', message, communityId],
                function(notifErr) {
                  if (notifErr) {
                    console.error('Error creating notification:', notifErr);
                  }
                }
              );

              // Emit socket notification
              const io = req.app.get('io');
              if (io) {
                io.to(`user_${targetUserId}`).emit('notification:receive', {
                  type: 'community_role_change',
                  content: message,
                  communityId: communityId
                });
              }
            }

            res.json({ success: true, message: `Member ${role === 'admin' ? 'promoted to admin' : 'role updated'}` });
          });
        }
      );
    }
  );
});

// Remove member from community
router.delete('/:communityId/members/:userId', authMiddleware, (req, res) => {
  const db = getDb();
  const { communityId, userId } = req.params;
  const targetUserId = parseInt(userId);
  const currentUserId = req.user.userId;

  // Verify current user is admin
  db.get(
    'SELECT role FROM community_members WHERE community_id = ? AND user_id = ?',
    [communityId, currentUserId],
    (err, member) => {
      if (err || !member || member.role !== 'admin') {
        return res.status(403).json({ error: 'Only admins can remove members' });
      }

      // Prevent removing yourself
      if (parseInt(targetUserId) === currentUserId) {
        return res.status(400).json({ error: 'Use "Leave Community" to remove yourself' });
      }

      // Get community admin info to check if we're removing the last admin
      db.get('SELECT admin_id FROM communities WHERE id = ?', [communityId], (err, community) => {
        if (err) {
          return res.status(500).json({ error: 'Error checking community' });
        }

        // Check if target is the original creator
        if (community && parseInt(targetUserId) === community.admin_id) {
          return res.status(400).json({ error: 'Cannot remove the community creator' });
        }

        // Remove member
        db.run(
          'DELETE FROM community_members WHERE community_id = ? AND user_id = ?',
          [communityId, targetUserId],
          function(err) {
            if (err) {
              return res.status(500).json({ error: 'Error removing member' });
            }

            if (this.changes === 0) {
              return res.status(404).json({ error: 'Member not found' });
            }

            // Create notification
            db.run(
              'INSERT INTO notifications (user_id, type, content, related_id) VALUES (?, ?, ?, ?)',
              [targetUserId, 'community_removed', 'You have been removed from the community', communityId],
              function(notifErr) {
                if (notifErr) {
                  console.error('Error creating notification:', notifErr);
                }
              }
            );

            // Emit socket notification
            const io = req.app.get('io');
            if (io) {
              io.to(`user_${targetUserId}`).emit('notification:receive', {
                type: 'community_removed',
                content: 'You have been removed from the community',
                communityId: communityId
              });
            }

            res.json({ success: true, message: 'Member removed successfully' });
          }
        );
      });
    }
  );
});

// Add member to community (by admin)
router.post('/:communityId/members/add', authMiddleware, (req, res) => {
  const db = getDb();
  const { communityId } = req.params;
  const { userId } = req.body;
  const currentUserId = req.user.userId;

  if (!userId) {
    return res.status(400).json({ error: 'User ID is required' });
  }

  // Verify current user is admin
  db.get(
    'SELECT role FROM community_members WHERE community_id = ? AND user_id = ?',
    [communityId, currentUserId],
    (err, member) => {
      if (err || !member || member.role !== 'admin') {
        return res.status(403).json({ error: 'Only admins can add members' });
      }

      // Check if user exists
      db.get('SELECT id, username FROM users WHERE id = ?', [userId], (err, user) => {
        if (err || !user) {
          return res.status(404).json({ error: 'User not found' });
        }

        // Check if user is already a member
        db.get(
          'SELECT * FROM community_members WHERE community_id = ? AND user_id = ?',
          [communityId, userId],
          (err, existingMember) => {
            if (existingMember) {
              return res.status(400).json({ error: 'User is already a member' });
            }

            // Add member
            db.run(
              'INSERT INTO community_members (community_id, user_id, role) VALUES (?, ?, ?)',
              [communityId, userId, 'member'],
              function(err) {
                if (err) {
                  return res.status(500).json({ error: 'Error adding member' });
                }

                // Get community name for notification
                db.get('SELECT name FROM communities WHERE id = ?', [communityId], (err, community) => {
                  if (!err && community) {
                    // Create notification
                    db.run(
                      'INSERT INTO notifications (user_id, type, content, related_id) VALUES (?, ?, ?, ?)',
                      [userId, 'community_added', `You have been added to ${community.name}`, communityId],
                      function(notifErr) {
                        if (notifErr) {
                          console.error('Error creating notification:', notifErr);
                        }
                      }
                    );

                    // Emit socket notification
                    const io = req.app.get('io');
                    if (io) {
                      io.to(`user-${userId}`).emit('notification:received', {
                        type: 'community_added',
                        content: `You have been added to ${community.name}`,
                        communityId: communityId
                      });
                    }
                  }

                  res.json({ 
                    success: true, 
                    message: 'Member added successfully',
                    user: {
                      id: user.id,
                      username: user.username
                    }
                  });
                });
              }
            );
          }
        );
      });
    }
  );
});

// Block user in community
router.post('/:communityId/members/:userId/block', authMiddleware, (req, res) => {
  const db = getDb();
  const { communityId, userId } = req.params;
  const targetUserId = parseInt(userId);
  const currentUserId = req.user.userId;

  // Verify current user is admin
  db.get(
    'SELECT role FROM community_members WHERE community_id = ? AND user_id = ?',
    [communityId, currentUserId],
    (err, member) => {
      if (err || !member || member.role !== 'admin') {
        return res.status(403).json({ error: 'Only admins can block members' });
      }

      // Cannot block yourself
      if (parseInt(targetUserId) === currentUserId) {
        return res.status(400).json({ error: 'You cannot block yourself' });
      }

      // Check if target is the community creator
      db.get('SELECT admin_id FROM communities WHERE id = ?', [communityId], (err, community) => {
        if (err) {
          return res.status(500).json({ error: 'Error checking community' });
        }

        if (community && parseInt(targetUserId) === community.admin_id) {
          return res.status(400).json({ error: 'Cannot block the community creator' });
        }

        // Check if already blocked
        db.get(
          'SELECT * FROM community_blocked_users WHERE community_id = ? AND user_id = ?',
          [communityId, targetUserId],
          (err, existing) => {
            if (existing) {
              return res.status(400).json({ error: 'User is already blocked' });
            }

            // Remove from members if they are one
            db.run(
              'DELETE FROM community_members WHERE community_id = ? AND user_id = ?',
              [communityId, targetUserId],
              function(err) {
                if (err) {
                  console.error('Error removing member:', err);
                }

                // Add to blocked list
                db.run(
                  'INSERT INTO community_blocked_users (community_id, user_id, blocked_by) VALUES (?, ?, ?)',
                  [communityId, targetUserId, currentUserId],
                  function(err) {
                    if (err) {
                      return res.status(500).json({ error: 'Error blocking user' });
                    }

                    // Create notification
                    db.run(
                      'INSERT INTO notifications (user_id, type, content, related_id) VALUES (?, ?, ?, ?)',
                      [targetUserId, 'community_blocked', 'You have been blocked from the community', communityId],
                      function(notifErr) {
                        if (notifErr) {
                          console.error('Error creating notification:', notifErr);
                        }
                      }
                    );

                    // Emit socket notification
                    const io = req.app.get('io');
                    if (io) {
                      io.to(`user-${targetUserId}`).emit('notification:received', {
                        type: 'community_blocked',
                        content: 'You have been blocked from the community',
                        communityId: communityId
                      });
                    }

                    res.json({ success: true, message: 'User blocked successfully' });
                  }
                );
              }
            );
          }
        );
      });
    }
  );
});

// Unblock user in community
router.delete('/:communityId/members/:userId/block', authMiddleware, (req, res) => {
  const db = getDb();
  const { communityId, userId } = req.params;
  const targetUserId = parseInt(userId);
  const currentUserId = req.user.userId;

  // Verify current user is admin
  db.get(
    'SELECT role FROM community_members WHERE community_id = ? AND user_id = ?',
    [communityId, currentUserId],
    (err, member) => {
      if (err || !member || member.role !== 'admin') {
        return res.status(403).json({ error: 'Only admins can unblock members' });
      }

      // Remove from blocked list
      db.run(
        'DELETE FROM community_blocked_users WHERE community_id = ? AND user_id = ?',
        [communityId, targetUserId],
        function(err) {
          if (err) {
            return res.status(500).json({ error: 'Error unblocking user' });
          }

          if (this.changes === 0) {
            return res.status(404).json({ error: 'User is not blocked' });
          }

          // Create notification
          db.run(
            'INSERT INTO notifications (user_id, type, content, related_id) VALUES (?, ?, ?, ?)',
            [targetUserId, 'community_unblocked', 'You have been unblocked from the community', communityId],
            function(notifErr) {
              if (notifErr) {
                console.error('Error creating notification:', notifErr);
              }
            }
          );

          res.json({ success: true, message: 'User unblocked successfully' });
        }
      );
    }
  );
});

// Get blocked users list
router.get('/:communityId/blocked', authMiddleware, (req, res) => {
  const db = getDb();
  const { communityId } = req.params;
  const currentUserId = req.user.userId;

  // Verify current user is admin
  db.get(
    'SELECT role FROM community_members WHERE community_id = ? AND user_id = ?',
    [communityId, currentUserId],
    (err, member) => {
      if (err || !member || member.role !== 'admin') {
        return res.status(403).json({ error: 'Only admins can view blocked users' });
      }

      // Get blocked users list
      db.all(
        `SELECT cbu.*, u.username, u.profile_picture, u2.username as blocked_by_username
         FROM community_blocked_users cbu
         JOIN users u ON cbu.user_id = u.id
         LEFT JOIN users u2 ON cbu.blocked_by = u2.id
         WHERE cbu.community_id = ?
         ORDER BY cbu.blocked_at DESC`,
        [communityId],
        (err, blockedUsers) => {
          if (err) {
            return res.status(500).json({ error: 'Error fetching blocked users' });
          }

          res.json({ success: true, blockedUsers });
        }
      );
    }
  );
});

module.exports = router;
