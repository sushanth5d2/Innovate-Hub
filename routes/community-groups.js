const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const upload = require('../middleware/upload');
const { getDb } = require('../config/database');
const fs = require('fs');
const path = require('path');

// Create folder structure for a group
function createGroupFolders(communityId, groupId) {
  const basePath = path.join(__dirname, '../uploads/communities', communityId.toString(), 'groups', groupId.toString());
  
  // Create folders
  const folders = [
    basePath,
    path.join(basePath, 'images'),
    path.join(basePath, 'documents'),
    path.join(basePath, 'videos'),
    path.join(basePath, 'files')
  ];

  folders.forEach(folder => {
    if (!fs.existsSync(folder)) {
      fs.mkdirSync(folder, { recursive: true });
    }
  });

  // Create links.json file
  const linksFile = path.join(basePath, 'links.json');
  if (!fs.existsSync(linksFile)) {
    fs.writeFileSync(linksFile, JSON.stringify({ links: [] }));
  }

  return basePath;
}

// Get file type from extension
function getFileType(filename) {
  const ext = path.extname(filename).toLowerCase();
  const imageExts = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg'];
  const videoExts = ['.mp4', '.mov', '.avi', '.mkv', '.webm'];
  const docExts = ['.pdf', '.doc', '.docx', '.txt', '.xls', '.xlsx', '.ppt', '.pptx'];

  if (imageExts.includes(ext)) return 'image';
  if (videoExts.includes(ext)) return 'video';
  if (docExts.includes(ext)) return 'document';
  return 'other';
}

// Create group in a community
router.post('/communities/:communityId/groups', authMiddleware, (req, res) => {
  const db = getDb();
  const userId = req.user.userId;
  const communityId = req.params.communityId;
  const { name, description } = req.body;

  if (!name) {
    return res.status(400).json({ error: 'Group name is required' });
  }

  // Check if user is a community member
  db.get(
    'SELECT * FROM community_members WHERE community_id = ? AND user_id = ?',
    [communityId, userId],
    (err, member) => {
      if (err || !member) {
        return res.status(403).json({ error: 'You must be a community member to create a group' });
      }

      // Create group
      db.run(
        `INSERT INTO community_groups (community_id, name, description, creator_id) 
         VALUES (?, ?, ?, ?)`,
        [communityId, name, description, userId],
        function(err) {
          if (err) {
            return res.status(500).json({ error: 'Error creating group' });
          }

          const groupId = this.lastID;

          // Add creator as admin
          db.run(
            'INSERT INTO community_group_members (group_id, user_id, role) VALUES (?, ?, ?)',
            [groupId, userId, 'admin'],
            (err) => {
              if (err) {
                return res.status(500).json({ error: 'Error adding admin to group' });
              }

              // Create folder structure
              try {
                createGroupFolders(communityId, groupId);
              } catch (error) {
                console.error('Error creating folders:', error);
              }

              res.json({
                success: true,
                message: 'Group created successfully',
                group: {
                  id: groupId,
                  community_id: communityId,
                  name,
                  description
                }
              });
            }
          );
        }
      );
    }
  );
});

// Get all groups in a community
router.get('/communities/:communityId/groups', authMiddleware, (req, res) => {
  const db = getDb();
  const userId = req.user.userId;
  const communityId = req.params.communityId;

  const query = `
    SELECT 
      cg.*,
      u.username as creator_username,
      (SELECT COUNT(*) FROM community_group_members WHERE group_id = cg.id) as member_count,
      (SELECT COUNT(*) FROM community_group_members WHERE group_id = cg.id AND user_id = ?) as is_member
    FROM community_groups cg
    JOIN users u ON cg.creator_id = u.id
    WHERE cg.community_id = ?
    ORDER BY cg.created_at DESC
  `;

  db.all(query, [userId, communityId], (err, groups) => {
    if (err) {
      return res.status(500).json({ error: 'Error fetching groups' });
    }
    res.json({ success: true, groups });
  });
});

// Get single group details
router.get('/community-groups/:groupId', authMiddleware, (req, res) => {
  const db = getDb();
  const userId = req.user.userId;
  const groupId = req.params.groupId;

  const query = `
    SELECT 
      cg.*,
      u.username as creator_username,
      (SELECT COUNT(*) FROM community_group_members WHERE group_id = cg.id) as member_count,
      (SELECT COUNT(*) FROM community_group_members WHERE group_id = cg.id AND user_id = ?) as is_member
    FROM community_groups cg
    JOIN users u ON cg.creator_id = u.id
    WHERE cg.id = ?
  `;

  db.get(query, [userId, groupId], (err, group) => {
    if (err || !group) {
      return res.status(404).json({ error: 'Group not found' });
    }
    res.json({ success: true, group });
  });
});

// Join group
router.post('/community-groups/:groupId/join', authMiddleware, (req, res) => {
  const db = getDb();
  const userId = req.user.userId;
  const groupId = req.params.groupId;

  // Check if user is already a member
  db.get(
    'SELECT * FROM community_group_members WHERE group_id = ? AND user_id = ?',
    [groupId, userId],
    (err, member) => {
      if (member) {
        return res.status(400).json({ error: 'Already a member' });
      }

      db.run(
        'INSERT INTO community_group_members (group_id, user_id, role) VALUES (?, ?, ?)',
        [groupId, userId, 'member'],
        (err) => {
          if (err) {
            return res.status(500).json({ error: 'Error joining group' });
          }
          res.json({ success: true, message: 'Joined group successfully' });
        }
      );
    }
  );
});

// Leave group
router.post('/community-groups/:groupId/leave', authMiddleware, (req, res) => {
  const db = getDb();
  const userId = req.user.userId;
  const groupId = req.params.groupId;

  db.run(
    'DELETE FROM community_group_members WHERE group_id = ? AND user_id = ?',
    [groupId, userId],
    (err) => {
      if (err) {
        return res.status(500).json({ error: 'Error leaving group' });
      }
      res.json({ success: true, message: 'Left group successfully' });
    }
  );
});

// Post in group
router.post('/community-groups/:groupId/posts', authMiddleware, (req, res, next) => {
  // Log all fields before multer processing
  console.log('POST /community-groups/:groupId/posts - Starting request');
  console.log('Headers:', req.headers['content-type']);
  next();
}, upload.fields([
  { name: 'attachments', maxCount: 10 }
]), (req, res) => {
  console.log('Multer processed. req.files:', req.files);
  console.log('req.body:', req.body);
  
  const db = getDb();
  const userId = req.user.userId;
  const groupId = req.params.groupId;
  const { content, location } = req.body;

  // Check if user is a member
  db.get(
    'SELECT * FROM community_group_members WHERE group_id = ? AND user_id = ?',
    [groupId, userId],
    (err, member) => {
      if (err || !member) {
        return res.status(403).json({ error: 'You must be a member to post' });
      }

      // Get group and community info
      db.get(
        'SELECT community_id FROM community_groups WHERE id = ?',
        [groupId],
        (err, group) => {
          if (err || !group) {
            return res.status(404).json({ error: 'Group not found' });
          }

          const communityId = group.community_id;
          let attachments = [];

          // Process uploaded files
          if (req.files && req.files.attachments) {
            const basePath = path.join(__dirname, '../uploads/communities', communityId.toString(), 'groups', groupId.toString());
            
            // Ensure base folders exist
            ['images', 'videos', 'documents', 'files'].forEach(folder => {
              const folderPath = path.join(basePath, folder);
              if (!fs.existsSync(folderPath)) {
                fs.mkdirSync(folderPath, { recursive: true });
              }
            });
            
            req.files.attachments.forEach(file => {
              const fileType = getFileType(file.filename);
              const targetFolder = fileType === 'image' ? 'images' : 
                                 fileType === 'video' ? 'videos' :
                                 fileType === 'document' ? 'documents' : 'files';
              
              const targetPath = path.join(basePath, targetFolder, file.filename);
              
              // Move file to organized folder
              try {
                if (fs.existsSync(file.path)) {
                  fs.renameSync(file.path, targetPath);
                  attachments.push(`/uploads/communities/${communityId}/groups/${groupId}/${targetFolder}/${file.filename}`);
                  
                  // Save file record
                  db.run(
                    `INSERT INTO community_group_files (group_id, user_id, filename, filepath, file_type, filesize)
                     VALUES (?, ?, ?, ?, ?, ?)`,
                    [groupId, userId, file.originalname, targetPath, fileType, file.size]
                  );
                }
              } catch (error) {
                console.error('Error moving file:', error);
              }
            });
          }

          // Add location if provided
          let postContent = content || '';
          if (location) {
            try {
              const loc = JSON.parse(location);
              postContent += `\n📍 Location: https://maps.google.com/?q=${loc.latitude},${loc.longitude}`;
            } catch (e) {
              console.error('Error parsing location:', e);
            }
          }

          // Create post
          db.run(
            `INSERT INTO community_group_posts (group_id, user_id, content, attachments)
             VALUES (?, ?, ?, ?)`,
            [groupId, userId, postContent, JSON.stringify(attachments)],
            function(err) {
              if (err) {
                console.error('Database error:', err);
                return res.status(500).json({ error: 'Error creating post' });
              }

              res.json({
                success: true,
                message: 'Post created successfully',
                post: {
                  id: this.lastID,
                  group_id: groupId,
                  user_id: userId,
                  content: postContent,
                  attachments
                }
              });
            }
          );
        }
      );
    }
  );
});

// Get group posts
router.get('/community-groups/:groupId/posts', authMiddleware, (req, res) => {
  const db = getDb();
  const userId = req.user.userId;
  const groupId = req.params.groupId;

  // Check if user is a member
  db.get(
    'SELECT * FROM community_group_members WHERE group_id = ? AND user_id = ?',
    [groupId, userId],
    (err, member) => {
      if (err || !member) {
        return res.status(403).json({ error: 'You must be a member to view posts' });
      }

      const query = `
        SELECT 
          cgp.*,
          u.username,
          u.profile_picture
        FROM community_group_posts cgp
        JOIN users u ON cgp.user_id = u.id
        WHERE cgp.group_id = ?
        ORDER BY cgp.created_at DESC
      `;

      db.all(query, [groupId], (err, posts) => {
        if (err) {
          return res.status(500).json({ error: 'Error fetching posts' });
        }

        // Parse attachments
        posts = posts.map(post => ({
          ...post,
          attachments: post.attachments ? JSON.parse(post.attachments) : []
        }));

        res.json({ success: true, posts });
      });
    }
  );
});

// Get group files (organized by type)
router.get('/community-groups/:groupId/files', authMiddleware, (req, res) => {
  const db = getDb();
  const userId = req.user.userId;
  const groupId = req.params.groupId;
  const { type } = req.query; // Filter by type: 'image', 'document', 'video', 'other'

  // Check if user is a member
  db.get(
    'SELECT * FROM community_group_members WHERE group_id = ? AND user_id = ?',
    [groupId, userId],
    (err, member) => {
      if (err || !member) {
        return res.status(403).json({ error: 'You must be a member to view files' });
      }

      let query = `
        SELECT 
          cgf.*,
          u.username,
          u.profile_picture
        FROM community_group_files cgf
        JOIN users u ON cgf.user_id = u.id
        WHERE cgf.group_id = ?
      `;

      const params = [groupId];

      if (type) {
        query += ' AND cgf.file_type = ?';
        params.push(type);
      }

      query += ' ORDER BY cgf.created_at DESC';

      db.all(query, params, (err, files) => {
        if (err) {
          return res.status(500).json({ error: 'Error fetching files' });
        }

        res.json({ success: true, files });
      });
    }
  );
});

// Save link in group
router.post('/community-groups/:groupId/links', authMiddleware, (req, res) => {
  const db = getDb();
  const userId = req.user.userId;
  const groupId = req.params.groupId;
  const { url, title, description } = req.body;

  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }

  // Check if user is a member
  db.get(
    'SELECT * FROM community_group_members WHERE group_id = ? AND user_id = ?',
    [groupId, userId],
    (err, member) => {
      if (err || !member) {
        return res.status(403).json({ error: 'You must be a member to save links' });
      }

      db.run(
        `INSERT INTO community_group_links (group_id, user_id, url, title, description)
         VALUES (?, ?, ?, ?, ?)`,
        [groupId, userId, url, title, description],
        function(err) {
          if (err) {
            return res.status(500).json({ error: 'Error saving link' });
          }

          res.json({
            success: true,
            message: 'Link saved successfully',
            link: {
              id: this.lastID,
              group_id: groupId,
              url,
              title,
              description
            }
          });
        }
      );
    }
  );
});

// Get group links
router.get('/community-groups/:groupId/links', authMiddleware, (req, res) => {
  const db = getDb();
  const userId = req.user.userId;
  const groupId = req.params.groupId;

  // Check if user is a member
  db.get(
    'SELECT * FROM community_group_members WHERE group_id = ? AND user_id = ?',
    [groupId, userId],
    (err, member) => {
      if (err || !member) {
        return res.status(403).json({ error: 'You must be a member to view links' });
      }

      const query = `
        SELECT 
          cgl.*,
          u.username,
          u.profile_picture
        FROM community_group_links cgl
        JOIN users u ON cgl.user_id = u.id
        WHERE cgl.group_id = ?
        ORDER BY cgl.created_at DESC
      `;

      db.all(query, [groupId], (err, links) => {
        if (err) {
          return res.status(500).json({ error: 'Error fetching links' });
        }

        res.json({ success: true, links });
      });
    }
  );
});

// Get group members
router.get('/community-groups/:groupId/members', authMiddleware, (req, res) => {
  const db = getDb();
  const groupId = req.params.groupId;

  const query = `
    SELECT 
      u.id,
      u.username,
      u.profile_picture,
      cgm.role,
      cgm.joined_at
    FROM community_group_members cgm
    JOIN users u ON cgm.user_id = u.id
    WHERE cgm.group_id = ?
    ORDER BY cgm.joined_at ASC
  `;

  db.all(query, [groupId], (err, members) => {
    if (err) {
      return res.status(500).json({ error: 'Error fetching members' });
    }

    res.json({ success: true, members });
  });
});

module.exports = router;
