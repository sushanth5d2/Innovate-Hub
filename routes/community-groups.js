const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const upload = require('../middleware/upload');
const { getDb } = require('../config/database');
const fs = require('fs');
const path = require('path');
const mlClient = require('../services/ml-client');
const crypto = require('crypto');

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
router.post('/communities/:communityId/groups', authMiddleware, upload.single('profile_picture'), (req, res) => {
  const db = getDb();
  const userId = req.user.userId;
  const communityId = req.params.communityId;
  const { name, description, is_public } = req.body;

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

      // Generate encryption key for E2E encryption
      const encryptionKey = crypto.randomBytes(32).toString('hex');
      
      // Handle profile picture upload
      let profilePicturePath = null;
      if (req.file) {
        const fileName = req.file.filename;
        const fileFolder = req.file.destination.replace('./uploads/', '');
        profilePicturePath = `/uploads/${fileFolder}/${fileName}`;
        console.log('Group profile picture uploaded:', profilePicturePath);
      }

      // Create group with profile picture and privacy setting
      db.run(
        `INSERT INTO community_groups (community_id, name, description, creator_id, encryption_key, profile_picture, is_public) 
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [communityId, name, description, userId, encryptionKey, profilePicturePath, parseInt(is_public) || 1],
        function(err) {
          if (err) {
            console.error('Error creating group:', err);
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
                  description,
                  profile_picture: profilePicturePath,
                  is_public: parseInt(is_public) || 1
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

  // Check if user is blocked
  db.get(
    'SELECT * FROM community_group_blocked WHERE group_id = ? AND user_id = ?',
    [groupId, userId],
    (err, blocked) => {
      if (blocked) {
        return res.status(403).json({ error: 'You are blocked from this group' });
      }

      // Check if user is already a member
      db.get(
        'SELECT * FROM community_group_members WHERE group_id = ? AND user_id = ?',
        [groupId, userId],
        (err, member) => {
          if (member) {
            return res.status(400).json({ error: 'Already a member' });
          }

          // Check if group is private
          db.get(
            'SELECT is_public FROM community_groups WHERE id = ?',
            [groupId],
            (err, group) => {
              if (err || !group) {
                return res.status(404).json({ error: 'Group not found' });
              }

              if (group.is_public === 0) {
                return res.status(403).json({ error: 'This is a private group. Please request to join.' });
              }

              // Join the group
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
        }
      );
    }
  );
});

// Get encryption key for group (only for members)
router.get('/community-groups/:groupId/encryption-key', authMiddleware, (req, res) => {
  const db = getDb();
  const userId = req.user.userId;
  const groupId = req.params.groupId;

  // Check if user is a member
  db.get(
    'SELECT * FROM community_group_members WHERE group_id = ? AND user_id = ?',
    [groupId, userId],
    (err, member) => {
      if (err || !member) {
        return res.status(403).json({ error: 'You must be a member to access encryption key' });
      }

      // Get encryption key
      db.get(
        'SELECT encryption_key FROM community_groups WHERE id = ?',
        [groupId],
        (err, group) => {
          if (err || !group) {
            return res.status(404).json({ error: 'Group not found' });
          }
          res.json({ 
            success: true, 
            encryption_key: group.encryption_key 
          });
        }
      );
    }
  );
});

// Update group settings (admin only)
router.put('/community-groups/:groupId', authMiddleware, upload.single('profile_picture'), (req, res) => {
  const db = getDb();
  const userId = req.user.userId;
  const groupId = req.params.groupId;
  const { name, description, is_public } = req.body;

  // Check if user is admin
  db.get(
    'SELECT * FROM community_group_members WHERE group_id = ? AND user_id = ? AND role = ?',
    [groupId, userId, 'admin'],
    (err, member) => {
      if (err || !member) {
        return res.status(403).json({ error: 'Only admins can update group settings' });
      }

      let updateFields = [];
      let updateValues = [];

      if (name) {
        updateFields.push('name = ?');
        updateValues.push(name);
      }

      if (description !== undefined) {
        updateFields.push('description = ?');
        updateValues.push(description);
      }

      if (is_public !== undefined) {
        updateFields.push('is_public = ?');
        updateValues.push(parseInt(is_public));
      }

      // Handle profile picture upload
      if (req.file) {
        // Get the correct subdirectory path from the file destination
        const fileName = req.file.filename;
        const fileFolder = req.file.destination.replace('./uploads/', '');
        const profilePicturePath = `/uploads/${fileFolder}/${fileName}`;
        updateFields.push('profile_picture = ?');
        updateValues.push(profilePicturePath);
        console.log('Group profile picture uploaded:', profilePicturePath);
      }

      updateFields.push('updated_at = CURRENT_TIMESTAMP');

      if (updateFields.length === 0) {
        return res.status(400).json({ error: 'No fields to update' });
      }

      const query = `UPDATE community_groups SET ${updateFields.join(', ')} WHERE id = ?`;
      updateValues.push(groupId);

      db.run(query, updateValues, function(err) {
        if (err) {
          return res.status(500).json({ error: 'Error updating group' });
        }

        // Get updated group
        db.get('SELECT * FROM community_groups WHERE id = ?', [groupId], (err, group) => {
          if (err) {
            return res.status(500).json({ error: 'Error fetching updated group' });
          }
          res.json({ success: true, group });
        });
      });
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

// Delete group
router.delete('/community-groups/:groupId', authMiddleware, (req, res) => {
  const db = getDb();
  const userId = req.user.userId;
  const groupId = req.params.groupId;

  // Check if user is creator or community admin
  db.get(
    `SELECT cg.*, c.admin_id as community_admin_id
     FROM community_groups cg
     JOIN communities c ON cg.community_id = c.id
     WHERE cg.id = ?`,
    [groupId],
    (err, group) => {
      if (err || !group) {
        return res.status(404).json({ error: 'Group not found' });
      }
      
      if (group.creator_id !== userId && group.community_admin_id !== userId) {
        return res.status(403).json({ error: 'Only the creator or community admin can delete the group' });
      }

      // Delete group (CASCADE will handle related data)
      db.run('DELETE FROM community_groups WHERE id = ?', [groupId], function(err) {
        if (err) {
          return res.status(500).json({ error: 'Error deleting group' });
        }

        // Try to delete group folder
        try {
          const basePath = path.join(__dirname, '../uploads/communities', group.community_id.toString(), 'groups', groupId.toString());
          if (fs.existsSync(basePath)) {
            fs.rmSync(basePath, { recursive: true, force: true });
          }
        } catch (error) {
          console.error('Error deleting group folder:', error);
        }

        res.json({ success: true });
      });
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
  const { content, location, reply_to } = req.body;

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
              const publicUrl = `/uploads/communities/${communityId}/groups/${groupId}/${targetFolder}/${file.filename}`;
              
              // Move file to organized folder
              try {
                if (fs.existsSync(file.path)) {
                  fs.renameSync(file.path, targetPath);
                  
                  // Push attachment object with all required properties
                  attachments.push({
                    filepath: publicUrl,
                    filename: file.originalname,
                    type: fileType,
                    size: file.size
                  });
                  
                  // Save file record
                  db.run(
                    `INSERT INTO community_group_files (group_id, user_id, filename, filepath, file_type, filesize)
                     VALUES (?, ?, ?, ?, ?, ?)`,
                    // Store public URL in DB so the client can open it directly.
                    [groupId, userId, file.originalname, publicUrl, fileType, file.size]
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
              const lat = loc?.latitude ?? loc?.lat;
              const lng = loc?.longitude ?? loc?.lng;
              if (typeof lat === 'number' && typeof lng === 'number') {
                postContent += `\n📍 Location: https://maps.google.com/?q=${lat},${lng}`;
              }
            } catch (e) {
              console.error('Error parsing location:', e);
            }
          }

          // Create post
          console.log('=== SAVING TO DATABASE ===');
          console.log('Attachments array before stringify:', attachments);
          console.log('Attachments JSON:', JSON.stringify(attachments));
          console.log('Reply to:', reply_to);
          
          db.run(
            `INSERT INTO community_group_posts (group_id, user_id, content, attachments, reply_to)
             VALUES (?, ?, ?, ?, ?)`,
            [groupId, userId, postContent, JSON.stringify(attachments), reply_to || null],
            function(err) {
              if (err) {
                console.error('Database error:', err);
                return res.status(500).json({ error: 'Error creating post' });
              }

              const postId = this.lastID;
              const io = req.app.get('io');

              // Hydrate with username/created_at for client rendering and realtime broadcast.
              db.get(
                `SELECT cgp.*, u.username, u.profile_picture
                 FROM community_group_posts cgp
                 JOIN users u ON cgp.user_id = u.id
                 WHERE cgp.id = ?`,
                [postId],
                (err2, postRow) => {
                  if (err2 || !postRow) {
                    const fallback = {
                      id: postId,
                      group_id: groupId,
                      user_id: userId,
                      content: postContent,
                      attachments
                    };
                    if (io) {
                      io.to(`community_group_${groupId}`).emit('community-group:post:new', fallback);
                    }
                    return res.json({ success: true, message: 'Post created successfully', post: fallback });
                  }

                  const hydrated = {
                    ...postRow,
                    attachments: postRow.attachments ? JSON.parse(postRow.attachments) : []
                  };

                  console.log('=== SENDING TO CLIENT ===');
                  console.log('Post row from DB:', postRow);
                  console.log('Attachments from DB (raw):', postRow.attachments);
                  console.log('Attachments parsed:', hydrated.attachments);

                  if (io) {
                    io.to(`community_group_${groupId}`).emit('community-group:post:new', hydrated);
                  }

                  return res.json({ success: true, message: 'Post created successfully', post: hydrated });
                }
              );
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
          u.profile_picture,
          reply_user.username as reply_to_username,
          reply_post.content as reply_to_content
        FROM community_group_posts cgp
        JOIN users u ON cgp.user_id = u.id
        LEFT JOIN community_group_posts reply_post ON cgp.reply_to = reply_post.id
        LEFT JOIN users reply_user ON reply_post.user_id = reply_user.id
        WHERE cgp.group_id = ? AND (cgp.is_deleted IS NULL OR cgp.is_deleted = 0)
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

function requireGroupMember(db, groupId, userId) {
  return new Promise((resolve, reject) => {
    db.get(
      'SELECT * FROM community_group_members WHERE group_id = ? AND user_id = ?',
      [groupId, userId],
      (err, member) => {
        if (err) return reject(err);
        if (!member) return resolve(null);
        resolve(member);
      }
    );
  });
}

function extractTasksFromText(text) {
  const cleaned = (text || '').trim();
  if (!cleaned) return [];

  const lines = cleaned
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(Boolean)
    .map(l => l.replace(/^[-*]\s+/, '').replace(/^\d+[\).]\s+/, '').trim())
    .filter(Boolean);

  if (lines.length === 0) return [];
  return lines.map(title => ({ title }));
}

// === Group Tasks (AI To-Do) ===

// List tasks for a group
router.get('/community-groups/:groupId/tasks', authMiddleware, async (req, res) => {
  const db = getDb();
  const userId = req.user.userId;
  const groupId = req.params.groupId;

  try {
    const member = await requireGroupMember(db, groupId, userId);
    if (!member) return res.status(403).json({ error: 'You must be a member to view tasks' });

    db.all(
      `SELECT t.*, u.username as created_by_username
       FROM community_group_tasks t
       JOIN users u ON t.created_by = u.id
       WHERE t.group_id = ?
       ORDER BY CASE t.status WHEN 'todo' THEN 1 WHEN 'in_progress' THEN 2 WHEN 'done' THEN 3 ELSE 4 END,
                COALESCE(t.due_date, t.created_at) ASC`,
      [groupId],
      (err, rows) => {
        if (err) return res.status(500).json({ error: 'Error fetching tasks' });
        const tasks = rows.map(r => ({
          ...r,
          assignees: r.assignees ? JSON.parse(r.assignees) : []
        }));
        res.json({ success: true, tasks });
      }
    );
  } catch (e) {
    res.status(500).json({ error: 'Error fetching tasks' });
  }
});

// Create tasks from text (simple extraction)
router.post('/community-groups/:groupId/tasks/from-text', authMiddleware, async (req, res) => {
  const db = getDb();
  const userId = req.user.userId;
  const groupId = req.params.groupId;
  const { text, priority = 'medium', due_date = null, assignees = [], description = '', subtasks = '[]', progress = 0 } = req.body || {};

  try {
    const member = await requireGroupMember(db, groupId, userId);
    if (!member) return res.status(403).json({ error: 'You must be a member to create tasks' });

    const tasks = extractTasksFromText(text);
    if (tasks.length === 0) return res.status(400).json({ error: 'No tasks found in text' });

    const created = [];
    const stmt = db.prepare(
      `INSERT INTO community_group_tasks (group_id, title, description, priority, status, due_date, assignees, progress, subtasks, source_type, source_ref, created_by)
       VALUES (?, ?, ?, ?, 'todo', ?, ?, ?, ?, 'text', ?, ?)`
    );

    tasks.forEach(t => {
      stmt.run(
        groupId,
        t.title,
        description,
        priority,
        due_date,
        JSON.stringify(Array.isArray(assignees) ? assignees : []),
        progress,
        subtasks,
        text || '',
        userId,
        function(err) {
          if (!err) created.push({ id: this.lastID, title: t.title });
        }
      );
    });

    stmt.finalize(() => res.json({ success: true, created_count: created.length, tasks: created }));
  } catch (e) {
    res.status(500).json({ error: 'Error creating tasks' });
  }
});

// Create tasks from image (OCR via ML service)
router.post('/community-groups/:groupId/tasks/from-image', authMiddleware, upload.single('image'), async (req, res) => {
  const db = getDb();
  const userId = req.user.userId;
  const groupId = req.params.groupId;

  if (!req.file) return res.status(400).json({ error: 'image file is required' });

  try {
    const member = await requireGroupMember(db, groupId, userId);
    if (!member) return res.status(403).json({ error: 'You must be a member to create tasks' });

    let analysis;
    try {
      analysis = await mlClient.analyzeImageForTasks(req.file.path);
    } catch (mlErr) {
      return res.status(503).json({ error: 'ML service unavailable for OCR task extraction' });
    }

    if (!analysis || !analysis.success || !Array.isArray(analysis.tasks) || analysis.tasks.length === 0) {
      return res.status(400).json({ error: analysis?.error || 'No tasks found in image' });
    }

    const created = [];
    const stmt = db.prepare(
      `INSERT INTO community_group_tasks (group_id, title, description, priority, status, due_date, assignees, progress, source_type, source_ref, created_by)
       VALUES (?, ?, ?, 'medium', 'todo', NULL, ?, 0, 'image', ?, ?)`
    );

    analysis.tasks.forEach(title => {
      stmt.run(
        groupId,
        String(title).trim(),
        '',
        JSON.stringify([]),
        analysis.extracted_text || '',
        userId,
        function(err) {
          if (!err) created.push({ id: this.lastID, title: String(title).trim() });
        }
      );
    });

    stmt.finalize(() => {
      res.json({
        success: true,
        source: {
          type: 'image',
          file: `/uploads/community/${req.file.filename}`,
          extracted_text: analysis.extracted_text || ''
        },
        created_count: created.length,
        tasks: created
      });
    });
  } catch (e) {
    res.status(500).json({ error: 'Error creating tasks from image' });
  }
});

// Update a task
router.patch('/community-groups/:groupId/tasks/:taskId', authMiddleware, async (req, res) => {
  const db = getDb();
  const userId = req.user.userId;
  const { groupId, taskId } = req.params;
  const { title, description, priority, status, due_date, assignees, progress, subtasks } = req.body || {};

  try {
    const member = await requireGroupMember(db, groupId, userId);
    if (!member) return res.status(403).json({ error: 'You must be a member to update tasks' });

    db.get(
      'SELECT * FROM community_group_tasks WHERE id = ? AND group_id = ?',
      [taskId, groupId],
      (err, existing) => {
        if (err || !existing) return res.status(404).json({ error: 'Task not found' });

        const next = {
          title: typeof title === 'string' ? title : existing.title,
          description: typeof description === 'string' ? description : existing.description,
          priority: typeof priority === 'string' ? priority : existing.priority,
          status: typeof status === 'string' ? status : existing.status,
          due_date: typeof due_date === 'undefined' ? existing.due_date : due_date,
          assignees: typeof assignees === 'undefined' ? existing.assignees : JSON.stringify(Array.isArray(assignees) ? assignees : []),
          progress: typeof progress === 'number' ? progress : existing.progress,
          subtasks: typeof subtasks === 'string' ? subtasks : existing.subtasks
        };

        db.run(
          `UPDATE community_group_tasks
           SET title = ?, description = ?, priority = ?, status = ?, due_date = ?, assignees = ?, progress = ?, subtasks = ?, updated_at = CURRENT_TIMESTAMP
           WHERE id = ? AND group_id = ?`,
          [
            next.title,
            next.description,
            next.priority,
            next.status,
            next.due_date,
            next.assignees,
            next.progress,
            next.subtasks,
            taskId,
            groupId
          ],
          (uErr) => {
            if (uErr) return res.status(500).json({ error: 'Error updating task' });
            res.json({ success: true });
          }
        );
      }
    );
  } catch (e) {
    res.status(500).json({ error: 'Error updating task' });
  }
});

// Delete a task
router.delete('/community-groups/:groupId/tasks/:taskId', authMiddleware, async (req, res) => {
  const db = getDb();
  const userId = req.user.userId;
  const { groupId, taskId } = req.params;

  try {
    const member = await requireGroupMember(db, groupId, userId);
    if (!member) return res.status(403).json({ error: 'You must be a member to delete tasks' });

    db.get(
      'SELECT * FROM community_group_tasks WHERE id = ? AND group_id = ?',
      [taskId, groupId],
      (err, existing) => {
        if (err || !existing) return res.status(404).json({ error: 'Task not found' });

        db.run(
          'DELETE FROM community_group_tasks WHERE id = ? AND group_id = ?',
          [taskId, groupId],
          (delErr) => {
            if (delErr) return res.status(500).json({ error: 'Error deleting task' });
            res.json({ success: true, message: 'Task deleted' });
          }
        );
      }
    );
  } catch (e) {
    res.status(500).json({ error: 'Error deleting task' });
  }
});

// === Group Notes (Markdown + versions) ===

router.get('/community-groups/:groupId/notes', authMiddleware, async (req, res) => {
  const db = getDb();
  const userId = req.user.userId;
  const groupId = req.params.groupId;

  try {
    const member = await requireGroupMember(db, groupId, userId);
    if (!member) return res.status(403).json({ error: 'You must be a member to view notes' });

    db.all(
      `SELECT n.*,
              cu.username as created_by_username,
              uu.username as updated_by_username
       FROM community_group_notes n
       JOIN users cu ON n.created_by = cu.id
       LEFT JOIN users uu ON n.updated_by = uu.id
       WHERE n.group_id = ?
       ORDER BY n.is_pinned DESC, n.updated_at DESC`,
      [groupId],
      (err, rows) => {
        if (err) return res.status(500).json({ error: 'Error fetching notes' });
        res.json({ success: true, notes: rows });
      }
    );
  } catch (e) {
    res.status(500).json({ error: 'Error fetching notes' });
  }
});

router.post('/community-groups/:groupId/notes', authMiddleware, async (req, res) => {
  const db = getDb();
  const userId = req.user.userId;
  const groupId = req.params.groupId;
  const { title, content_md = '' } = req.body || {};

  if (!title) return res.status(400).json({ error: 'title is required' });

  try {
    const member = await requireGroupMember(db, groupId, userId);
    if (!member) return res.status(403).json({ error: 'You must be a member to create notes' });

    db.run(
      `INSERT INTO community_group_notes (group_id, title, content_md, created_by, updated_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, datetime('now', '+5 hours', '+30 minutes'), datetime('now', '+5 hours', '+30 minutes'))`,
      [groupId, title, content_md, userId, userId],
      function(err) {
        if (err) return res.status(500).json({ error: 'Error creating note' });
        res.json({ success: true, note: { id: this.lastID, group_id: Number(groupId), title } });
      }
    );
  } catch (e) {
    res.status(500).json({ error: 'Error creating note' });
  }
});

// Upload image for notes
router.post('/community-groups/upload-image', authMiddleware, upload.single('images'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image file uploaded' });
    }

    const imageUrl = `/uploads/${req.file.path.replace(/\\/g, '/').split('uploads/')[1]}`;
    res.json({ success: true, url: imageUrl, imageUrl });
  } catch (error) {
    console.error('Error uploading image:', error);
    res.status(500).json({ error: 'Failed to upload image' });
  }
});

// Upload file for notes
router.post('/community-groups/upload-file', authMiddleware, upload.single('files'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const fileUrl = `/uploads/${req.file.path.replace(/\\/g, '/').split('uploads/')[1]}`;
    res.json({ success: true, url: fileUrl, fileUrl, filename: req.file.originalname });
  } catch (error) {
    console.error('Error uploading file:', error);
    res.status(500).json({ error: 'Failed to upload file' });
  }
});

router.get('/community-groups/notes/:noteId', authMiddleware, (req, res) => {
  const db = getDb();
  const userId = req.user.userId;
  const noteId = req.params.noteId;

  db.get(
    `SELECT n.*, cu.username as created_by_username, uu.username as updated_by_username
     FROM community_group_notes n
     JOIN users cu ON n.created_by = cu.id
     LEFT JOIN users uu ON n.updated_by = uu.id
     WHERE n.id = ?`,
    [noteId],
    async (err, note) => {
      if (err || !note) return res.status(404).json({ error: 'Note not found' });
      try {
        const member = await requireGroupMember(db, note.group_id, userId);
        if (!member) return res.status(403).json({ error: 'You must be a member to view this note' });
        res.json({ success: true, note });
      } catch (e) {
        res.status(500).json({ error: 'Error fetching note' });
      }
    }
  );
});

router.put('/community-groups/notes/:noteId', authMiddleware, (req, res) => {
  const db = getDb();
  const userId = req.user.userId;
  const noteId = req.params.noteId;
  const { title, content_md } = req.body || {};

  db.get('SELECT * FROM community_group_notes WHERE id = ?', [noteId], async (err, existing) => {
    if (err || !existing) return res.status(404).json({ error: 'Note not found' });
    try {
      const member = await requireGroupMember(db, existing.group_id, userId);
      if (!member) return res.status(403).json({ error: 'You must be a member to update notes' });

      // Check if note is locked
      if (existing.is_locked) {
        return res.status(403).json({ error: 'This note is locked and cannot be edited' });
      }

      // Save version before update
      db.run(
        `INSERT INTO community_group_note_versions (note_id, content_md, created_by)
         VALUES (?, ?, ?)`,
        [noteId, existing.content_md || '', userId]
      );

      const nextTitle = typeof title === 'string' ? title : existing.title;
      const nextContent = typeof content_md === 'string' ? content_md : existing.content_md;

      db.run(
        `UPDATE community_group_notes
         SET title = ?, content_md = ?, updated_by = ?, updated_at = datetime('now', '+5 hours', '+30 minutes')
         WHERE id = ?`,
        [nextTitle, nextContent, userId, noteId],
        (uErr) => {
          if (uErr) return res.status(500).json({ error: 'Error updating note' });
          res.json({ success: true });
        }
      );
    } catch (e) {
      res.status(500).json({ error: 'Error updating note' });
    }
  });
});

// Pin/Unpin note
router.put('/community-groups/notes/:noteId/pin', authMiddleware, async (req, res) => {
  const db = getDb();
  const userId = req.user.userId;
  const noteId = req.params.noteId;
  const { is_pinned } = req.body;

  try {
    const note = await new Promise((resolve, reject) => {
      db.get('SELECT * FROM community_group_notes WHERE id = ?', [noteId], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    if (!note) return res.status(404).json({ error: 'Note not found' });

    const member = await requireGroupMember(db, note.group_id, userId);
    if (!member) return res.status(403).json({ error: 'Permission denied' });

    db.run(
      'UPDATE community_group_notes SET is_pinned = ? WHERE id = ?',
      [is_pinned ? 1 : 0, noteId],
      (err) => {
        if (err) return res.status(500).json({ error: 'Failed to update note' });
        res.json({ success: true });
      }
    );
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Lock/Unlock note
router.put('/community-groups/notes/:noteId/lock', authMiddleware, async (req, res) => {
  const db = getDb();
  const userId = req.user.userId;
  const noteId = req.params.noteId;
  const { is_locked } = req.body;

  try {
    const note = await new Promise((resolve, reject) => {
      db.get('SELECT * FROM community_group_notes WHERE id = ?', [noteId], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    if (!note) return res.status(404).json({ error: 'Note not found' });

    const member = await requireGroupMember(db, note.group_id, userId);
    if (!member) return res.status(403).json({ error: 'Permission denied' });

    db.run(
      'UPDATE community_group_notes SET is_locked = ? WHERE id = ?',
      [is_locked ? 1 : 0, noteId],
      (err) => {
        if (err) return res.status(500).json({ error: 'Failed to update note' });
        res.json({ success: true });
      }
    );
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Archive/Unarchive note
router.put('/community-groups/notes/:noteId/archive', authMiddleware, async (req, res) => {
  const db = getDb();
  const userId = req.user.userId;
  const noteId = req.params.noteId;
  const { is_archived } = req.body;

  try {
    const note = await new Promise((resolve, reject) => {
      db.get('SELECT * FROM community_group_notes WHERE id = ?', [noteId], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    if (!note) return res.status(404).json({ error: 'Note not found' });

    const member = await requireGroupMember(db, note.group_id, userId);
    if (!member) return res.status(403).json({ error: 'Permission denied' });

    db.run(
      'UPDATE community_group_notes SET is_archived = ? WHERE id = ?',
      [is_archived ? 1 : 0, noteId],
      (err) => {
        if (err) return res.status(500).json({ error: 'Failed to update note' });
        res.json({ success: true });
      }
    );
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Duplicate note
router.post('/community-groups/notes/:noteId/duplicate', authMiddleware, async (req, res) => {
  const db = getDb();
  const userId = req.user.userId;
  const noteId = req.params.noteId;

  try {
    const note = await new Promise((resolve, reject) => {
      db.get('SELECT * FROM community_group_notes WHERE id = ?', [noteId], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    if (!note) return res.status(404).json({ error: 'Note not found' });

    const member = await requireGroupMember(db, note.group_id, userId);
    if (!member) return res.status(403).json({ error: 'Permission denied' });

    db.run(
      `INSERT INTO community_group_notes (group_id, title, content_md, created_by, updated_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, datetime('now', '+5 hours', '+30 minutes'), datetime('now', '+5 hours', '+30 minutes'))`,
      [note.group_id, note.title + ' (Copy)', note.content_md, userId, userId],
      function(err) {
        if (err) return res.status(500).json({ error: 'Failed to duplicate note' });
        res.json({ success: true, noteId: this.lastID });
      }
    );
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Delete note
router.delete('/community-groups/notes/:noteId', authMiddleware, async (req, res) => {
  const db = getDb();
  const userId = req.user.userId;
  const noteId = req.params.noteId;

  try {
    const note = await new Promise((resolve, reject) => {
      db.get('SELECT * FROM community_group_notes WHERE id = ?', [noteId], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    if (!note) return res.status(404).json({ error: 'Note not found' });

    const member = await requireGroupMember(db, note.group_id, userId);
    if (!member) return res.status(403).json({ error: 'Permission denied' });

    // Delete note versions first
    db.run('DELETE FROM community_group_note_versions WHERE note_id = ?', [noteId]);
    
    // Delete the note
    db.run('DELETE FROM community_group_notes WHERE id = ?', [noteId], (err) => {
      if (err) return res.status(500).json({ error: 'Failed to delete note' });
      res.json({ success: true });
    });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/community-groups/notes/:noteId/versions', authMiddleware, (req, res) => {
  const db = getDb();
  const userId = req.user.userId;
  const noteId = req.params.noteId;

  db.get('SELECT group_id FROM community_group_notes WHERE id = ?', [noteId], async (err, note) => {
    if (err || !note) return res.status(404).json({ error: 'Note not found' });
    try {
      const member = await requireGroupMember(db, note.group_id, userId);
      if (!member) return res.status(403).json({ error: 'You must be a member to view versions' });

      db.all(
        `SELECT v.id, v.note_id, v.created_at, u.username as created_by_username
         FROM community_group_note_versions v
         JOIN users u ON v.created_by = u.id
         WHERE v.note_id = ?
         ORDER BY v.created_at DESC`,
        [noteId],
        (e2, rows) => {
          if (e2) return res.status(500).json({ error: 'Error fetching versions' });
          res.json({ success: true, versions: rows });
        }
      );
    } catch (e) {
      res.status(500).json({ error: 'Error fetching versions' });
    }
  });
});

router.post('/community-groups/notes/:noteId/restore/:versionId', authMiddleware, (req, res) => {
  const db = getDb();
  const userId = req.user.userId;
  const { noteId, versionId } = req.params;

  db.get('SELECT group_id FROM community_group_notes WHERE id = ?', [noteId], async (err, note) => {
    if (err || !note) return res.status(404).json({ error: 'Note not found' });
    try {
      const member = await requireGroupMember(db, note.group_id, userId);
      if (!member) return res.status(403).json({ error: 'You must be a member to restore versions' });

      db.get(
        'SELECT content_md FROM community_group_note_versions WHERE id = ? AND note_id = ?',
        [versionId, noteId],
        (e2, version) => {
          if (e2 || !version) return res.status(404).json({ error: 'Version not found' });

          db.run(
            `UPDATE community_group_notes
             SET content_md = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP
             WHERE id = ?`,
            [version.content_md || '', userId, noteId],
            (uErr) => {
              if (uErr) return res.status(500).json({ error: 'Error restoring version' });
              res.json({ success: true });
            }
          );
        }
      );
    } catch (e) {
      res.status(500).json({ error: 'Error restoring version' });
    }
  });
});

// ==================== GROUP MESSAGE EDIT ====================
// Edit group message (both PATCH and PUT supported)
const editMessageHandler = (req, res) => {
  const db = getDb();
  const { groupId, postId } = req.params;
  const { content } = req.body;
  const userId = req.user.userId;
  const attachmentFiles = req.files?.attachments || [];

  // Check if user is member
  db.get('SELECT * FROM community_group_members WHERE group_id = ? AND user_id = ?',
    [groupId, userId],
    (err, member) => {
      if (err || !member) return res.status(403).json({ error: 'You must be a member' });

      // Check if user is the author
      db.get('SELECT * FROM community_group_posts WHERE id = ? AND group_id = ?',
        [postId, groupId],
        (err, post) => {
          if (err || !post) return res.status(404).json({ error: 'Message not found' });
          if (post.user_id !== userId) {
            return res.status(403).json({ error: 'You can only edit your own messages' });
          }

          // If attachments are being replaced
          if (attachmentFiles.length > 0) {
            const attachmentPaths = attachmentFiles.map(f => f.path.replace(/\\/g, '/'));
            const attachmentsJSON = JSON.stringify(attachmentPaths);

            // Delete old attachments from filesystem
            if (post.attachments) {
              try {
                const oldAttachments = JSON.parse(post.attachments);
                const fs = require('fs');
                oldAttachments.forEach(oldPath => {
                  try {
                    if (fs.existsSync(oldPath)) {
                      fs.unlinkSync(oldPath);
                    }
                  } catch (e) {
                    console.error('Error deleting old attachment:', e);
                  }
                });
              } catch (e) {
                console.error('Error parsing old attachments:', e);
              }
            }

            db.run(
              'UPDATE community_group_posts SET attachments = ?, is_edited = 1, edited_at = CURRENT_TIMESTAMP WHERE id = ?',
              [attachmentsJSON, postId],
              function(err) {
                if (err) return res.status(500).json({ error: 'Error updating message' });

                const io = req.app.get('io');
                if (io) {
                  io.to(`community_group_${groupId}`).emit('message:edited', {
                    groupId,
                    postId,
                    attachments: attachmentPaths,
                    editedAt: new Date().toISOString()
                  });
                }

                res.json({ success: true });
              }
            );
          }
          // If only text content is being updated
          else if (content && content.trim()) {
            db.run(
              'UPDATE community_group_posts SET content = ?, is_edited = 1, edited_at = CURRENT_TIMESTAMP WHERE id = ?',
              [content.trim(), postId],
              function(err) {
                if (err) return res.status(500).json({ error: 'Error updating message' });

                const io = req.app.get('io');
                if (io) {
                  io.to(`community_group_${groupId}`).emit('message:edited', {
                    groupId,
                    postId,
                    content: content.trim(),
                    editedAt: new Date().toISOString()
                  });
                }

                res.json({ success: true });
              }
            );
          } else {
            return res.status(400).json({ error: 'Content or attachments required' });
          }
        }
      );
    }
  );
};

router.patch('/community-groups/:groupId/posts/:postId', authMiddleware, upload.fields([{ name: 'attachments', maxCount: 10 }]), editMessageHandler);
router.put('/community-groups/:groupId/posts/:postId', authMiddleware, upload.fields([{ name: 'attachments', maxCount: 10 }]), editMessageHandler);

// ==================== GROUP MESSAGE DELETE ====================
// Delete group message (soft delete)
router.delete('/community-groups/:groupId/posts/:postId', authMiddleware, (req, res) => {
  const db = getDb();
  const { groupId, postId } = req.params;
  const userId = req.user.userId;

  db.get('SELECT * FROM community_group_members WHERE group_id = ? AND user_id = ?',
    [groupId, userId],
    (err, member) => {
      if (err || !member) return res.status(403).json({ error: 'You must be a member' });

      db.get('SELECT * FROM community_group_posts WHERE id = ? AND group_id = ?',
        [postId, groupId],
        (err, post) => {
          if (err || !post) return res.status(404).json({ error: 'Message not found' });

          const isAuthor = post.user_id === userId;
          const isAdmin = member.role === 'admin';

          if (!isAuthor && !isAdmin) {
            return res.status(403).json({ error: 'You can only delete your own messages or be admin' });
          }

          // Soft delete
          db.run(
            'UPDATE community_group_posts SET is_deleted = 1, content = ? WHERE id = ?',
            ['[Message deleted]', postId],
            function(err) {
              if (err) return res.status(500).json({ error: 'Error deleting message' });

              const io = req.app.get('io');
              if (io) {
                io.to(`community_group_${groupId}`).emit('message:deleted', {
                  groupId,
                  postId
                });
              }

              res.json({ success: true });
            }
          );
        }
      );
    }
  );
});

// ==================== GROUP MESSAGE REACTIONS ====================
// Add reaction to group message
router.post('/community-groups/:groupId/posts/:postId/reactions', authMiddleware, (req, res) => {
  const db = getDb();
  const { groupId, postId } = req.params;
  const { reaction_type } = req.body;
  const userId = req.user.userId;

  const validReactions = ['like', 'love', 'care', 'haha', 'wow', 'sad', 'angry'];
  if (!validReactions.includes(reaction_type)) {
    return res.status(400).json({ error: 'Invalid reaction type' });
  }

  db.get('SELECT * FROM community_group_members WHERE group_id = ? AND user_id = ?',
    [groupId, userId],
    (err, member) => {
      if (err || !member) return res.status(403).json({ error: 'You must be a member' });

      db.run(
        'INSERT OR REPLACE INTO group_message_reactions (message_id, user_id, reaction_type) VALUES (?, ?, ?)',
        [postId, userId, reaction_type],
        function(err) {
          if (err) return res.status(500).json({ error: 'Error adding reaction' });

          db.all(
            'SELECT reaction_type, COUNT(*) as count FROM group_message_reactions WHERE message_id = ? GROUP BY reaction_type',
            [postId],
            (err, reactions) => {
              const io = req.app.get('io');
              if (io) {
                io.to(`community_group_${groupId}`).emit('message:reaction', {
                  groupId,
                  postId,
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

// Remove reaction from group message
router.delete('/community-groups/:groupId/posts/:postId/reactions/:reactionType', authMiddleware, (req, res) => {
  const db = getDb();
  const { postId, reactionType } = req.params;
  const userId = req.user.userId;

  db.run(
    'DELETE FROM group_message_reactions WHERE message_id = ? AND user_id = ? AND reaction_type = ?',
    [postId, userId, reactionType],
    function(err) {
      if (err) return res.status(500).json({ error: 'Error removing reaction' });
      res.json({ success: true });
    }
  );
});

// Get message reactions
router.get('/community-groups/:groupId/posts/:postId/reactions', authMiddleware, (req, res) => {
  const db = getDb();
  const { postId } = req.params;
  const userId = req.user.userId;

  db.all(
    `SELECT gmr.reaction_type, gmr.user_id, u.username, u.profile_picture,
            (SELECT reaction_type FROM group_message_reactions WHERE message_id = ? AND user_id = ?) as user_reaction
     FROM group_message_reactions gmr
     JOIN users u ON gmr.user_id = u.id
     WHERE gmr.message_id = ?
     ORDER BY gmr.created_at DESC`,
    [postId, userId, postId],
    (err, reactions) => {
      if (err) return res.status(500).json({ error: 'Error fetching reactions' });

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

// ==================== GROUP POLLS ====================
// Create poll in group
router.post('/community-groups/:groupId/polls', authMiddleware, (req, res) => {
  const db = getDb();
  const { groupId } = req.params;
  const { question, options, expiresIn } = req.body;
  const userId = req.user.userId;

  if (!question || !options || !Array.isArray(options) || options.length < 2) {
    return res.status(400).json({ error: 'Question and at least 2 options are required' });
  }

  db.get('SELECT * FROM community_group_members WHERE group_id = ? AND user_id = ?',
    [groupId, userId],
    (err, member) => {
      if (err || !member) return res.status(403).json({ error: 'You must be a member' });

      let expiresAt = null;
      if (expiresIn) {
        expiresAt = new Date(Date.now() + expiresIn * 60000).toISOString();
      }

      db.run(
        'INSERT INTO group_polls (group_id, user_id, question, options, expires_at) VALUES (?, ?, ?, ?, ?)',
        [groupId, userId, question, JSON.stringify(options), expiresAt],
        function(err) {
          if (err) return res.status(500).json({ error: 'Error creating poll' });

          const pollId = this.lastID;
          const io = req.app.get('io');
          if (io) {
            io.to(`community_group_${groupId}`).emit('poll:created', {
              groupId,
              poll: {
                id: pollId,
                question,
                options,
                expiresAt
              }
            });
          }

          res.json({
            success: true,
            poll: {
              id: pollId,
              question,
              options,
              expiresAt
            }
          });
        }
      );
    }
  );
});

// Vote on group poll
router.post('/community-groups/:groupId/polls/:pollId/vote', authMiddleware, (req, res) => {
  const db = getDb();
  const { groupId, pollId } = req.params;
  const { optionIndex } = req.body;
  const userId = req.user.userId;

  if (typeof optionIndex !== 'number' || optionIndex < 0) {
    return res.status(400).json({ error: 'Invalid option index' });
  }

  db.get('SELECT * FROM community_group_members WHERE group_id = ? AND user_id = ?',
    [groupId, userId],
    (err, member) => {
      if (err || !member) return res.status(403).json({ error: 'You must be a member' });

      db.get('SELECT * FROM group_polls WHERE id = ? AND group_id = ?',
        [pollId, groupId],
        (err, poll) => {
          if (err || !poll) return res.status(404).json({ error: 'Poll not found' });

          // Check if poll expired
          if (poll.expires_at && new Date(poll.expires_at) < new Date()) {
            return res.status(400).json({ error: 'Poll has expired' });
          }

          const options = JSON.parse(poll.options);
          if (optionIndex >= options.length) {
            return res.status(400).json({ error: 'Invalid option index' });
          }

          db.run(
            'INSERT OR REPLACE INTO group_poll_votes (poll_id, user_id, option_index) VALUES (?, ?, ?)',
            [pollId, userId, optionIndex],
            function(err) {
              if (err) return res.status(500).json({ error: 'Error recording vote' });

              // Get vote counts
              db.all(
                'SELECT option_index, COUNT(*) as count FROM group_poll_votes WHERE poll_id = ? GROUP BY option_index',
                [pollId],
                (err, votes) => {
                  const voteCounts = new Array(options.length).fill(0);
                  let totalVotes = 0;

                  votes.forEach(v => {
                    if (v.option_index >= 0 && v.option_index < voteCounts.length) {
                      voteCounts[v.option_index] = v.count;
                      totalVotes += v.count;
                    }
                  });

                  const results = {
                    question: poll.question,
                    options,
                    voteCounts,
                    totalVotes,
                    userVote: optionIndex,
                    percentages: voteCounts.map(count => totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0)
                  };

                  const io = req.app.get('io');
                  if (io) {
                    io.to(`community_group_${groupId}`).emit('poll:voted', {
                      groupId,
                      pollId,
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
    }
  );
});

// Get poll results
router.get('/community-groups/:groupId/polls/:pollId', authMiddleware, (req, res) => {
  const db = getDb();
  const { groupId, pollId } = req.params;
  const userId = req.user.userId;

  db.get('SELECT * FROM community_group_members WHERE group_id = ? AND user_id = ?',
    [groupId, userId],
    (err, member) => {
      if (err || !member) return res.status(403).json({ error: 'You must be a member' });

      db.get('SELECT * FROM group_polls WHERE id = ? AND group_id = ?',
        [pollId, groupId],
        (err, poll) => {
          if (err || !poll) return res.status(404).json({ error: 'Poll not found' });

          const options = JSON.parse(poll.options);

          // Get user's vote
          db.get(
            'SELECT option_index FROM group_poll_votes WHERE poll_id = ? AND user_id = ?',
            [pollId, userId],
            (err, userVote) => {
              // Get all votes
              db.all(
                'SELECT option_index, COUNT(*) as count FROM group_poll_votes WHERE poll_id = ? GROUP BY option_index',
                [pollId],
                (err, votes) => {
                  const voteCounts = new Array(options.length).fill(0);
                  let totalVotes = 0;

                  votes.forEach(v => {
                    if (v.option_index >= 0 && v.option_index < voteCounts.length) {
                      voteCounts[v.option_index] = v.count;
                      totalVotes += v.count;
                    }
                  });

                  const results = {
                    id: poll.id,
                    question: poll.question,
                    options,
                    voteCounts,
                    totalVotes,
                    userVote: userVote ? userVote.option_index : null,
                    percentages: voteCounts.map(count => totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0),
                    expiresAt: poll.expires_at,
                    isExpired: poll.expires_at && new Date(poll.expires_at) < new Date()
                  };

                  res.json({ success: true, poll: results });
                }
              );
            }
          );
        }
      );
    }
  );
});

// Get all group polls
router.get('/community-groups/:groupId/polls', authMiddleware, (req, res) => {
  const db = getDb();
  const { groupId } = req.params;
  const userId = req.user.userId;

  db.get('SELECT * FROM community_group_members WHERE group_id = ? AND user_id = ?',
    [groupId, userId],
    (err, member) => {
      if (err || !member) return res.status(403).json({ error: 'You must be a member' });

      db.all(
        `SELECT gp.*, u.username, u.profile_picture
         FROM group_polls gp
         JOIN users u ON gp.user_id = u.id
         WHERE gp.group_id = ?
         ORDER BY gp.created_at DESC`,
        [groupId],
        (err, polls) => {
          if (err) return res.status(500).json({ error: 'Error fetching polls' });

          // Get vote counts for each poll
          const pollPromises = polls.map(poll => {
            return new Promise((resolve) => {
              db.all(
                'SELECT option_index, COUNT(*) as count FROM group_poll_votes WHERE poll_id = ? GROUP BY option_index',
                [poll.id],
                (err, votes) => {
                  const options = JSON.parse(poll.options);
                  const voteCounts = new Array(options.length).fill(0);
                  let totalVotes = 0;

                  votes.forEach(v => {
                    if (v.option_index >= 0 && v.option_index < voteCounts.length) {
                      voteCounts[v.option_index] = v.count;
                      totalVotes += v.count;
                    }
                  });

                  resolve({
                    ...poll,
                    options,
                    voteCounts,
                    totalVotes,
                    isExpired: poll.expires_at && new Date(poll.expires_at) < new Date()
                  });
                }
              );
            });
          });

          Promise.all(pollPromises).then(enrichedPolls => {
            res.json({ success: true, polls: enrichedPolls });
          });
        }
      );
    }
  );
});

// ==================== MEMBER MANAGEMENT ROUTES ====================

// Get group members with roles
router.get('/community-groups/:groupId/members', authMiddleware, (req, res) => {
  const db = getDb();
  const groupId = req.params.groupId;
  const userId = req.user.userId;

  // Check if user is a member or admin
  db.get(
    'SELECT role FROM community_group_members WHERE group_id = ? AND user_id = ?',
    [groupId, userId],
    (err, membership) => {
      if (err || !membership) {
        return res.status(403).json({ error: 'Not authorized' });
      }

      // Get all members with user details
      db.all(
        `SELECT gm.*, u.username, u.profile_picture, u.email, g.creator_id,
         CASE WHEN g.creator_id = gm.user_id THEN 'creator'
              ELSE gm.role
         END as role
         FROM community_group_members gm
         JOIN users u ON gm.user_id = u.id
         JOIN community_groups g ON gm.group_id = g.id
         WHERE gm.group_id = ?
         ORDER BY 
           CASE WHEN g.creator_id = gm.user_id THEN 1
                WHEN gm.role = 'admin' THEN 2
                ELSE 3
           END,
           gm.joined_at ASC`,
        [groupId],
        (err, members) => {
          if (err) {
            console.error('Error fetching members:', err);
            return res.status(500).json({ error: 'Error fetching members' });
          }

          res.json({
            success: true,
            members,
            userRole: membership.role
          });
        }
      );
    }
  );
});

// Promote member to admin
router.post('/community-groups/:groupId/members/:userId/promote', authMiddleware, (req, res) => {
  const db = getDb();
  const groupId = req.params.groupId;
  const targetUserId = req.params.userId;
  const adminId = req.user.userId;

  // Check if requester is creator
  db.get(
    'SELECT creator_id FROM community_groups WHERE id = ?',
    [groupId],
    (err, group) => {
      if (err || !group) {
        return res.status(404).json({ error: 'Group not found' });
      }

      if (group.creator_id !== adminId) {
        return res.status(403).json({ error: 'Only the group creator can promote members' });
      }

      // Promote member
      db.run(
        'UPDATE community_group_members SET role = ? WHERE group_id = ? AND user_id = ?',
        ['admin', groupId, targetUserId],
        (err) => {
          if (err) {
            console.error('Error promoting member:', err);
            return res.status(500).json({ error: 'Error promoting member' });
          }

          res.json({ success: true, message: 'Member promoted to admin' });
        }
      );
    }
  );
});

// Remove member from group
router.delete('/community-groups/:groupId/members/:userId', authMiddleware, (req, res) => {
  const db = getDb();
  const groupId = req.params.groupId;
  const targetUserId = req.params.userId;
  const adminId = req.user.userId;

  // Check if requester is admin or creator
  db.get(
    `SELECT g.creator_id, gm.role 
     FROM community_groups g
     LEFT JOIN community_group_members gm ON gm.group_id = g.id AND gm.user_id = ?
     WHERE g.id = ?`,
    [adminId, groupId],
    (err, group) => {
      if (err || !group) {
        return res.status(404).json({ error: 'Group not found' });
      }

      const isCreator = group.creator_id === adminId;
      const isAdmin = group.role === 'admin';

      if (!isCreator && !isAdmin) {
        return res.status(403).json({ error: 'Only admins can remove members' });
      }

      // Can't remove creator
      if (targetUserId == group.creator_id) {
        return res.status(403).json({ error: 'Cannot remove group creator' });
      }

      // Remove member
      db.run(
        'DELETE FROM community_group_members WHERE group_id = ? AND user_id = ?',
        [groupId, targetUserId],
        (err) => {
          if (err) {
            console.error('Error removing member:', err);
            return res.status(500).json({ error: 'Error removing member' });
          }

          res.json({ success: true, message: 'Member removed' });
        }
      );
    }
  );
});

// Block member from group
router.post('/community-groups/:groupId/members/:userId/block', authMiddleware, (req, res) => {
  const db = getDb();
  const groupId = req.params.groupId;
  const targetUserId = req.params.userId;
  const adminId = req.user.userId;

  // Check if requester is admin or creator
  db.get(
    `SELECT g.creator_id, gm.role 
     FROM community_groups g
     LEFT JOIN community_group_members gm ON gm.group_id = g.id AND gm.user_id = ?
     WHERE g.id = ?`,
    [adminId, groupId],
    (err, group) => {
      if (err || !group) {
        return res.status(404).json({ error: 'Group not found' });
      }

      const isCreator = group.creator_id === adminId;
      const isAdmin = group.role === 'admin';

      if (!isCreator && !isAdmin) {
        return res.status(403).json({ error: 'Only admins can block members' });
      }

      // Can't block creator
      if (targetUserId == group.creator_id) {
        return res.status(403).json({ error: 'Cannot block group creator' });
      }

      // Remove from members first
      db.run(
        'DELETE FROM community_group_members WHERE group_id = ? AND user_id = ?',
        [groupId, targetUserId],
        (err) => {
          if (err) {
            console.error('Error removing member:', err);
            return res.status(500).json({ error: 'Error removing member' });
          }

          // Add to blocked list
          db.run(
            'INSERT OR IGNORE INTO community_group_blocked (group_id, user_id, blocked_by) VALUES (?, ?, ?)',
            [groupId, targetUserId, adminId],
            (err) => {
              if (err) {
                console.error('Error blocking member:', err);
                return res.status(500).json({ error: 'Error blocking member' });
              }

              res.json({ success: true, message: 'Member blocked' });
            }
          );
        }
      );
    }
  );
});

// Get blocked members
router.get('/community-groups/:groupId/blocked', authMiddleware, (req, res) => {
  const db = getDb();
  const groupId = req.params.groupId;
  const userId = req.user.userId;

  // Check if user is admin or creator
  db.get(
    `SELECT g.creator_id, gm.role 
     FROM community_groups g
     LEFT JOIN community_group_members gm ON gm.group_id = g.id AND gm.user_id = ?
     WHERE g.id = ?`,
    [userId, groupId],
    (err, group) => {
      if (err || !group) {
        return res.status(404).json({ error: 'Group not found' });
      }

      const isCreator = group.creator_id === userId;
      const isAdmin = group.role === 'admin';

      if (!isCreator && !isAdmin) {
        return res.status(403).json({ error: 'Only admins can view blocked members' });
      }

      // Get blocked members
      db.all(
        `SELECT gb.*, u.username, u.profile_picture
         FROM community_group_blocked gb
         JOIN users u ON gb.user_id = u.id
         WHERE gb.group_id = ?
         ORDER BY gb.blocked_at DESC`,
        [groupId],
        (err, blocked) => {
          if (err) {
            console.error('Error fetching blocked members:', err);
            return res.status(500).json({ error: 'Error fetching blocked members' });
          }

          res.json({ success: true, blocked: blocked || [] });
        }
      );
    }
  );
});

// Unblock member
router.post('/community-groups/:groupId/members/:userId/unblock', authMiddleware, (req, res) => {
  const db = getDb();
  const groupId = req.params.groupId;
  const targetUserId = req.params.userId;
  const adminId = req.user.userId;

  // Check if requester is admin or creator
  db.get(
    `SELECT g.creator_id, gm.role 
     FROM community_groups g
     LEFT JOIN community_group_members gm ON gm.group_id = g.id AND gm.user_id = ?
     WHERE g.id = ?`,
    [adminId, groupId],
    (err, group) => {
      if (err || !group) {
        return res.status(404).json({ error: 'Group not found' });
      }

      const isCreator = group.creator_id === adminId;
      const isAdmin = group.role === 'admin';

      if (!isCreator && !isAdmin) {
        return res.status(403).json({ error: 'Only admins can unblock members' });
      }

      // Remove from blocked list
      db.run(
        'DELETE FROM community_group_blocked WHERE group_id = ? AND user_id = ?',
        [groupId, targetUserId],
        (err) => {
          if (err) {
            console.error('Error unblocking member:', err);
            return res.status(500).json({ error: 'Error unblocking member' });
          }

          res.json({ success: true, message: 'Member unblocked' });
        }
      );
    }
  );
});

// ==================== JOIN REQUEST ROUTES ====================

// Request to join private group
router.post('/community-groups/:groupId/request-join', authMiddleware, (req, res) => {
  const db = getDb();
  const groupId = req.params.groupId;
  const userId = req.user.userId;

  // Check if group is private
  db.get(
    'SELECT * FROM community_groups WHERE id = ?',
    [groupId],
    (err, group) => {
      if (err || !group) {
        return res.status(404).json({ error: 'Group not found' });
      }

      if (group.is_public !== 0) {
        return res.status(400).json({ error: 'This group is public, you can join directly' });
      }

      // Check if already a member
      db.get(
        'SELECT * FROM community_group_members WHERE group_id = ? AND user_id = ?',
        [groupId, userId],
        (err, member) => {
          if (member) {
            return res.status(400).json({ error: 'Already a member' });
          }

          // Check if already blocked
          db.get(
            'SELECT * FROM community_group_blocked WHERE group_id = ? AND user_id = ?',
            [groupId, userId],
            (err, blocked) => {
              if (blocked) {
                return res.status(403).json({ error: 'You are blocked from this group' });
              }

              // Create join request
              db.run(
                'INSERT OR REPLACE INTO community_group_join_requests (group_id, user_id, status) VALUES (?, ?, ?)',
                [groupId, userId, 'pending'],
                (err) => {
                  if (err) {
                    console.error('Error creating join request:', err);
                    return res.status(500).json({ error: 'Error creating join request' });
                  }

                  res.json({ success: true, message: 'Join request sent' });
                }
              );
            }
          );
        }
      );
    }
  );
});

// Get join requests for a group
router.get('/community-groups/:groupId/join-requests', authMiddleware, (req, res) => {
  const db = getDb();
  const groupId = req.params.groupId;
  const userId = req.user.userId;

  // Check if user is admin or creator
  db.get(
    `SELECT g.creator_id, gm.role 
     FROM community_groups g
     LEFT JOIN community_group_members gm ON gm.group_id = g.id AND gm.user_id = ?
     WHERE g.id = ?`,
    [userId, groupId],
    (err, group) => {
      if (err || !group) {
        return res.status(404).json({ error: 'Group not found' });
      }

      const isCreator = group.creator_id === userId;
      const isAdmin = group.role === 'admin';

      if (!isCreator && !isAdmin) {
        return res.status(403).json({ error: 'Only admins can view join requests' });
      }

      // Get pending requests
      db.all(
        `SELECT jr.*, u.username, u.profile_picture
         FROM community_group_join_requests jr
         JOIN users u ON jr.user_id = u.id
         WHERE jr.group_id = ? AND jr.status = 'pending'
         ORDER BY jr.created_at DESC`,
        [groupId],
        (err, requests) => {
          if (err) {
            console.error('Error fetching join requests:', err);
            return res.status(500).json({ error: 'Error fetching join requests' });
          }

          res.json({ success: true, requests: requests || [] });
        }
      );
    }
  );
});

// Approve join request
router.post('/community-groups/:groupId/join-requests/:userId/approve', authMiddleware, (req, res) => {
  const db = getDb();
  const groupId = req.params.groupId;
  const targetUserId = req.params.userId;
  const adminId = req.user.userId;

  // Check if requester is admin or creator
  db.get(
    `SELECT g.creator_id, gm.role 
     FROM community_groups g
     LEFT JOIN community_group_members gm ON gm.group_id = g.id AND gm.user_id = ?
     WHERE g.id = ?`,
    [adminId, groupId],
    (err, group) => {
      if (err || !group) {
        return res.status(404).json({ error: 'Group not found' });
      }

      const isCreator = group.creator_id === adminId;
      const isAdmin = group.role === 'admin';

      if (!isCreator && !isAdmin) {
        return res.status(403).json({ error: 'Only admins can approve join requests' });
      }

      // Add member
      db.run(
        'INSERT INTO community_group_members (group_id, user_id, role) VALUES (?, ?, ?)',
        [groupId, targetUserId, 'member'],
        (err) => {
          if (err) {
            console.error('Error adding member:', err);
            return res.status(500).json({ error: 'Error adding member' });
          }

          // Delete join request
          db.run(
            'DELETE FROM community_group_join_requests WHERE group_id = ? AND user_id = ?',
            [groupId, targetUserId],
            (err) => {
              if (err) {
                console.error('Error deleting join request:', err);
              }

              res.json({ success: true, message: 'Join request approved' });
            }
          );
        }
      );
    }
  );
});

// Reject join request
router.post('/community-groups/:groupId/join-requests/:userId/reject', authMiddleware, (req, res) => {
  const db = getDb();
  const groupId = req.params.groupId;
  const targetUserId = req.params.userId;
  const adminId = req.user.userId;

  // Check if requester is admin or creator
  db.get(
    `SELECT g.creator_id, gm.role 
     FROM community_groups g
     LEFT JOIN community_group_members gm ON gm.group_id = g.id AND gm.user_id = ?
     WHERE g.id = ?`,
    [adminId, groupId],
    (err, group) => {
      if (err || !group) {
        return res.status(404).json({ error: 'Group not found' });
      }

      const isCreator = group.creator_id === adminId;
      const isAdmin = group.role === 'admin';

      if (!isCreator && !isAdmin) {
        return res.status(403).json({ error: 'Only admins can reject join requests' });
      }

      // Delete join request
      db.run(
        'DELETE FROM community_group_join_requests WHERE group_id = ? AND user_id = ?',
        [groupId, targetUserId],
        (err) => {
          if (err) {
            console.error('Error rejecting join request:', err);
            return res.status(500).json({ error: 'Error rejecting join request' });
          }

          res.json({ success: true, message: 'Join request rejected' });
        }
      );
    }
  );
});

module.exports = router;

