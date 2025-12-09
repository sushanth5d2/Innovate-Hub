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
           (SELECT COUNT(*) FROM community_members WHERE community_id = c.id AND user_id = ?) as is_member
    FROM communities c
    JOIN users u ON c.admin_id = u.id
    WHERE c.is_public = 1
  `;

  const params = [userId];

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
router.post('/', authMiddleware, upload.single('banner_image'), (req, res) => {
  const db = getDb();
  const userId = req.user.userId;
  const { name, description, team_name, is_public } = req.body;
  
  let banner_image = null;
  if (req.file) {
    banner_image = `/uploads/community/${req.file.filename}`;
  }

  const query = `
    INSERT INTO communities (name, description, team_name, banner_image, is_public, admin_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `;

  db.run(query, [name, description, team_name, banner_image, is_public ? 1 : 0, userId], function(err) {
    if (err) {
      if (err.message.includes('UNIQUE')) {
        return res.status(400).json({ error: 'Community name already exists' });
      }
      return res.status(500).json({ error: 'Error creating community' });
    }

    const communityId = this.lastID;

    // Add creator as admin member
    db.run(
      'INSERT INTO community_members (community_id, user_id, role) VALUES (?, ?, ?)',
      [communityId, userId, 'admin'],
      (err) => {
        if (err) {
          return res.status(500).json({ error: 'Error adding admin to community' });
        }

        res.json({
          success: true,
          community: {
            id: communityId,
            name,
            description,
            team_name,
            banner_image,
            admin_id: userId
          }
        });
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

        // Notify admin
        db.run(
          'INSERT INTO notifications (user_id, type, content, related_id) VALUES (?, ?, ?, ?)',
          [community.admin_id, 'community_join', 'joined your community', communityId]
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

    db.run(
      'DELETE FROM community_members WHERE community_id = ? AND user_id = ?',
      [communityId, userId],
      function(err) {
        if (err) {
          return res.status(500).json({ error: 'Error leaving community' });
        }
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

module.exports = router;
